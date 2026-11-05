import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

const cli = resolve("src/cli/main.ts");
const directories: string[] = [];
const children: ReturnType<typeof spawn>[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

async function files(cwd: string, entries: Record<string, string>) {
  for (const [name, content] of Object.entries(entries)) {
    await mkdir(dirname(join(cwd, name)), { recursive: true });
    await writeFile(join(cwd, name), content);
  }
}

async function project(entries: Record<string, string>) {
  const cwd = await mkdtemp(join(process.cwd(), ".stack-test-db-"));
  directories.push(cwd);
  await files(cwd, entries);
  return cwd;
}

function environment(overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(?:_+VARLOCK|_STACK_DATABASE|NODE_ENV$|APP_ENV$|HOST$|PORT$|DATABASE_URL$)/.test(key))
      delete env[key];
  return { ...env, NO_COLOR: "1", VARLOCK_TELEMETRY_DISABLED: "1", ...overrides };
}

function run(cwd: string, args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync("bun", ["--no-env-file", cli, ...args], {
    cwd,
    env: environment(overrides),
    encoding: "utf8",
    timeout: 25_000,
  });
}

test("doctor counts local migrations without executing config or resolving credentials", async () => {
  const cwd = await project({
    "src/server/index.ts": "",
    "drizzle.config.ts": 'throw new Error("config must not execute");',
    "env/server/.env.schema": "# @required\nDATABASE_URL=exec(`exit 97`)\n",
  });
  const missing = run(cwd, ["doctor", "--json"]);
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout).database).toMatchObject({
    enabled: true,
    directory: "migrations",
    count: 0,
    ready: false,
    reason: expect.stringContaining("production"),
  });
  await files(cwd, {
    "migrations/20261105000000_initial/migration.sql": "CREATE TABLE messages (id INTEGER);",
    "migrations/notes.txt": "not a migration",
  });
  const ready = run(cwd, ["doctor", "--json"]);
  expect(ready.status, ready.stderr).toBe(0);
  expect(JSON.parse(ready.stdout).database).toMatchObject({ enabled: true, count: 1, ready: true });
  expect(run(cwd, ["doctor"]).stdout).toContain("1 local migration");
});

const schema = `import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
export const messages = sqliteTable("messages", { id: integer().primaryKey(), text: text().notNull() });`;
const config = `import { defineConfig } from "drizzle-kit";
import { ENV } from "@prinpo/stack/env";
export default defineConfig({ dialect: "sqlite", out: "./migrations", schema: "./schema.ts", dbCredentials: { url: ENV.DATABASE_URL } });`;

test("native generation needs no dynamic credentials and explicit migrations select the server profile", async () => {
  const cwd = await project({
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic @required\nDATABASE_URL=exec(`exit 97`)\n",
    "env/server/.env.staging": "DATABASE_URL=sqlite://staging.sqlite\n",
    "probe.ts": `import { SQL } from "bun"; const db = new SQL("sqlite://staging.sqlite"); console.log(JSON.stringify(await db\`SELECT name FROM sqlite_master WHERE type='table' AND name='messages'\`)); await db.close();`,
  });
  const generated = run(cwd, ["db", "generate", "--name", "initial"]);
  expect(generated.status, generated.stdout + generated.stderr).toBe(0);
  const migrated = run(cwd, ["db", "migrate", "--env", "staging"]);
  expect(migrated.status, migrated.stdout + migrated.stderr).toBe(0);
  const probe = spawnSync("bun", ["--no-env-file", "probe.ts"], { cwd, encoding: "utf8" });
  expect(probe.status, probe.stderr).toBe(0);
  expect(JSON.parse(probe.stdout)).toEqual([{ name: "messages" }]);
});

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

function launch(cwd: string, args: string[], overrides: NodeJS.ProcessEnv, direct = false) {
  const child = spawn("bun", ["--no-env-file", ...(direct ? args : [cli, ...args])], {
    cwd,
    env: environment(overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  return { child, output: () => output };
}

const server = {
  "src/server/index.ts": `import { startServer } from "@prinpo/stack/server"; const app = await startServer(() => import("./app"), {env:{client:false}}); process.on("SIGTERM", async () => { await app.stop(); process.exit(143); });`,
  "src/server/app.ts": `import { Elysia, t } from "@prinpo/stack/server";
import { SQL } from "bun"; import { drizzle } from "drizzle-orm/bun-sql/sqlite";
import { ENV } from "@prinpo/stack/env"; import { messages } from "../../schema";
await Bun.write("app-imported", "yes");
const client = new SQL(ENV.DATABASE_URL); const db = drizzle({client});
await db.select().from(messages);
export const app = new Elysia().get("/api/messages", () => db.select().from(messages))
.post("/api/messages", ({body}) => db.insert(messages).values(body).returning(), {body:t.Object({text:t.String()})})
.onStop(async () => { await client.close(); });`,
};

test("a built backend migrates before app import without source files and preserves data on direct restart", async () => {
  const cwd = await project({
    ...server,
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic @required\nDATABASE_URL=exec(`printf x >> resolutions; printf sqlite://app.sqlite`)\n",
  });
  const generated = run(cwd, ["db", "generate", "--name", "initial"]);
  expect(generated.status, generated.stdout + generated.stderr).toBe(0);
  const built = run(cwd, ["build"]);
  expect(built.status, built.stdout + built.stderr).toBe(0);
  expect(
    JSON.parse(await readFile(join(cwd, "dist/manifest.json"), "utf8")).database,
  ).toMatchObject({
    config: "dist/database/drizzle.config.js",
    migrations: "dist/database/migrations",
  });
  await expect(readFile(join(cwd, "resolutions"))).rejects.toThrow();
  for (const name of ["src", "schema.ts", "drizzle.config.ts", "migrations"])
    await rm(join(cwd, name), { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const started = launch(cwd, ["start"], { PORT: String(port) });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(origin + "/api/messages")).status;
        } catch {
          return started.output();
        }
      },
      { timeout: 10_000 },
    )
    .toBe(200);
  expect(
    await (
      await fetch(origin + "/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "persisted" }),
      })
    ).json(),
  ).toEqual([{ id: 1, text: "persisted" }]);
  started.child.kill("SIGTERM");
  await once(started.child, "exit");
  const restarted = launch(
    cwd,
    ["dist/server/index.js"],
    { NODE_ENV: "production", PORT: String(port) },
    true,
  );
  await expect
    .poll(
      async () => {
        try {
          return await (await fetch(origin + "/api/messages")).json();
        } catch {
          return restarted.output();
        }
      },
      { timeout: 10_000 },
    )
    .toEqual([{ id: 1, text: "persisted" }]);
  expect(await readFile(join(cwd, "resolutions"), "utf8")).toBe("xx");
}, 30_000);

test("missing migrations fail build before config execution and invalidate a previous manifest", async () => {
  const cwd = await project({
    "src/server/index.ts": "",
    "drizzle.config.ts": 'throw new Error("must not run at build");',
    "dist/manifest.json": '{"version":1,"backend":true,"frontend":false}',
  });
  const result = run(cwd, ["build"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("No migrations found");
  expect(result.stderr).not.toContain("must not run at build");
  await expect(readFile(join(cwd, "dist/manifest.json"))).rejects.toThrow();
});

test("database builds generate local environment types before compiling config without runtime credentials", async () => {
  const cwd = await project({
    "index.html": "<html><head></head><body>Clean build</body></html>",
    "drizzle.config.ts": config.replace('"@prinpo/stack/env"', '"./src/env/server"'),
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# @generateTsTypes(path=../../src/env/server.ts,exposeEnv=local,icons=false)\n# ---\n# @dynamic @required\nDATABASE_URL=exec(`printf resolved > provider-ran; exit 97`)\n",
    "migrations/20261105000000_initial/migration.sql": "CREATE TABLE messages (id INTEGER);",
  });
  const built = run(cwd, ["build"]);
  expect(built.status, built.stdout + built.stderr).toBe(0);
  expect(await readFile(join(cwd, "src/env/server.ts"), "utf8")).toContain("DATABASE_URL");
  await expect(readFile(join(cwd, "provider-ran"))).rejects.toThrow();
});

test("failed production SQL prevents app import and does not hide missing built artifacts behind sources", async () => {
  const cwd = await project({
    ...server,
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nDATABASE_URL=sqlite://failure.sqlite\n",
  });
  expect(run(cwd, ["db", "generate"]).status).toBe(0);
  expect(run(cwd, ["build"]).status).toBe(0);
  const [migration] = await readdir(join(cwd, "dist/database/migrations"));
  const sqlPath = join(cwd, "dist/database/migrations", migration, "migration.sql");
  const originalSql = await readFile(sqlPath, "utf8");
  const pendingSql =
    originalSql + "\n--> statement-breakpoint\nINSERT INTO messages (id, text) VALUES (1, 'once');";
  await writeFile(sqlPath, pendingSql + "\n--> statement-breakpoint\nINVALID SQL;");
  const failed = run(cwd, ["start"]);
  expect(failed.status, failed.stdout + failed.stderr).not.toBe(0);
  await expect(readFile(join(cwd, "app-imported"))).rejects.toThrow();
  await writeFile(sqlPath, pendingSql);
  const port = await freePort();
  const retried = launch(cwd, ["start"], { PORT: String(port) });
  await expect
    .poll(
      async () => {
        try {
          return await (await fetch(`http://127.0.0.1:${port}/api/messages`)).json();
        } catch {
          return retried.output();
        }
      },
      { timeout: 10_000 },
    )
    .toEqual([{ id: 1, text: "once" }]);
  retried.child.kill("SIGTERM");
  await once(retried.child, "exit");
  await rm(join(cwd, "dist/database/drizzle.config.js"));
  const missing = run(cwd, ["start"]);
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain("Database build artifacts missing");
});

test("frontend-only production uses packaged migrations and validates server credentials only when enabled", async () => {
  const cwd = await project({
    "index.html": "<html><head></head><body>Database ready</body></html>",
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nHOST=exec(`printf h >> connection-resolutions; printf 127.0.0.1`)\n# @dynamic\nDATABASE_URL=exec(`printf x >> resolutions; printf sqlite://frontend.sqlite`)\n",
  });
  expect(run(cwd, ["db", "generate"]).status).toBe(0);
  const built = run(cwd, ["build"]);
  expect(built.status, built.stdout + built.stderr).toBe(0);
  for (const name of ["drizzle.config.ts", "schema.ts", "migrations", "index.html"])
    await rm(join(cwd, name), { recursive: true });
  const port = await freePort();
  const started = launch(cwd, ["start"], { PORT: String(port) });
  await expect
    .poll(
      async () => {
        try {
          return await (await fetch(`http://127.0.0.1:${port}`)).text();
        } catch {
          return started.output();
        }
      },
      { timeout: 10_000 },
    )
    .toContain("Database ready");
  expect(started.output()).toContain("migrations complete");
  expect(await readFile(join(cwd, "resolutions"), "utf8")).toBe("x");
  expect(await readFile(join(cwd, "connection-resolutions"), "utf8")).toBe("h");
}, 30_000);

test("interrupting production migration stops its subprocess and never imports the app", async () => {
  const cwd = await project({
    ...server,
    "schema.ts": schema,
    "drizzle.config.ts": `import {writeFileSync} from "node:fs";
if (process.env.NODE_ENV === "production") { writeFileSync("migration-pid", String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); }
${config}`,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nDATABASE_URL=sqlite://interrupted.sqlite\n",
  });
  expect(run(cwd, ["db", "generate"]).status).toBe(0);
  expect(run(cwd, ["build"]).status).toBe(0);
  const started = launch(cwd, ["start"], {});
  await expect
    .poll(
      async () => {
        try {
          return Number(await readFile(join(cwd, "migration-pid"), "utf8")) > 0;
        } catch {
          return started.output();
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const pid = Number(await readFile(join(cwd, "migration-pid"), "utf8"));
  const exit = once(started.child, "exit");
  started.child.kill("SIGTERM");
  expect((await exit)[0]).not.toBe(0);
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await expect(readFile(join(cwd, "app-imported"))).rejects.toThrow();
}, 30_000);

test("database command help and local operations preserve native behavior without credentials", async () => {
  const cwd = await project({
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic @required\nDATABASE_URL=exec(`exit 97`)\n",
  });
  for (const operation of [
    "generate",
    "migrate",
    "push",
    "pull",
    "studio",
    "check",
    "up",
    "export",
  ]) {
    const help = run(cwd, ["db", operation, "--help"]);
    expect(help.status, help.stdout + help.stderr).toBe(0);
    expect(help.stdout).toContain(operation);
  }
  expect(run(cwd, ["db", "generate", "--name=initial"]).status).toBe(0);
  for (const operation of ["check", "up", "export"]) {
    const result = run(cwd, ["db", operation]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }
  const invalid = run(cwd, ["db", "generate", "--not-an-option"]);
  expect(invalid.status).not.toBe(0);
});

test("development leaves schemas untouched while direct production startup applies a new release", async () => {
  const cwd = await project({
    ...server,
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nDATABASE_URL=sqlite://release.sqlite\n",
  });
  expect(run(cwd, ["db", "generate", "--name", "initial"]).status).toBe(0);
  // The fixture queries its table during import: development must fail rather than migrate it.
  const development = spawnSync("bun", ["--no-env-file", "src/server/index.ts"], {
    cwd,
    env: environment({ NODE_ENV: "development" }),
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(development.status).not.toBe(0);
  expect(development.stderr).toContain("messages");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const first = launch(
    cwd,
    ["src/server/index.ts"],
    { NODE_ENV: "production", PORT: String(port) },
    true,
  );
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(origin + "/api/messages")).status;
        } catch {
          return first.output();
        }
      },
      { timeout: 10_000 },
    )
    .toBe(200);
  await fetch(origin + "/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "before upgrade" }),
  });
  first.child.kill("SIGTERM");
  await once(first.child, "exit");
  await files(cwd, {
    "schema.ts": schema.replace(
      "text: text().notNull()",
      "text: text().notNull(), category: text().notNull().default('general')",
    ),
  });
  const generated = run(cwd, ["db", "generate", "--name", "category"]);
  expect(generated.status, generated.stdout + generated.stderr).toBe(0);
  expect(run(cwd, ["build"]).status).toBe(0);
  const second = launch(cwd, ["start"], { PORT: String(port) });
  await expect
    .poll(
      async () => {
        try {
          return await (await fetch(origin + "/api/messages")).json();
        } catch {
          return second.output();
        }
      },
      { timeout: 10_000 },
    )
    .toEqual([{ id: 1, text: "before upgrade", category: "general" }]);
}, 30_000);
