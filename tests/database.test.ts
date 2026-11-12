import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  const human = run(cwd, ["doctor"]);
  expect(human.stdout).toContain("Database\n  ✓ Drizzle\n    1 local migration in migrations/\n");
  const colored = run(cwd, ["doctor"], { NO_COLOR: undefined, FORCE_COLOR: "1" });
  expect(colored.stdout).toContain("\u001b[32m✓\u001b[39m Drizzle");
});

const schema = `import { sqliteTable, integer, text } from "@prinpo/stack/database/sqlite-core";
export const messages = sqliteTable("messages", { id: integer().primaryKey(), text: text().notNull() });`;
const config = `import { defineConfig } from "@prinpo/stack/database";
import { ENV } from "@prinpo/stack/env";
export default defineConfig({ dialect: "sqlite", schema: "./schema.ts", dbCredentials: { url: ENV.DATABASE_URL } });`;

test("Stack database config fixes the migration directory even when a spread supplies out", async () => {
  const cwd = await project({
    "schema.ts": schema,
    "drizzle.config.ts": `import {defineConfig} from "@prinpo/stack/database";
const overrides={out:"./elsewhere"};
const config=defineConfig({...overrides,dialect:"sqlite",schema:"./schema.ts",dbCredentials:{url:"sqlite://test.sqlite"}});
try {config.out="./changed";} catch {}
export default config;`,
  });
  const generated = run(cwd, ["db", "generate", "--name", "initial"]);
  expect(generated.status, generated.stdout + generated.stderr).toBe(0);
  expect(JSON.parse(run(cwd, ["doctor", "--json"]).stdout).database).toMatchObject({
    count: 1,
    ready: true,
  });
  await expect(readFile(join(cwd, "elsewhere"))).rejects.toThrow();
  const overridden = run(cwd, ["db", "generate", "--out", "./elsewhere"]);
  expect(overridden.status).not.toBe(0);
  expect(overridden.stderr).toContain("Stack owns the migration directory");
});

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

test.each([
  ["SIGTERM", 143, "default"],
  ["SIGINT", 130, "callback"],
  ["SIGTERM", 1, "failure"],
] as const)(
  "startServer owns %s shutdown with %s status using %s cleanup",
  async (signal, status, kind) => {
    const cleanup =
      kind === "default"
        ? ""
        : `, onStop: async (status) => { console.log("cleanup:" + status); await app.stop(); ${kind === "failure" ? 'throw new Error("cleanup failed");' : ""} }`;
    const cwd = await project({
      "src/server/index.ts": `import {startServer} from "@prinpo/stack/server"; const app=await startServer(()=>import("./app"),{env:{client:false}${cleanup}});`,
      "src/server/app.ts": `import {Elysia} from "@prinpo/stack/server"; export const app=new Elysia().get("/ready",()=>"ready");`,
    });
    const port = await freePort();
    const started = launch(
      cwd,
      ["src/server/index.ts"],
      { NODE_ENV: "development", PORT: String(port), NO_COLOR: undefined, FORCE_COLOR: "1" },
      true,
    );
    await expect
      .poll(async () => {
        try {
          return await (await fetch(`http://127.0.0.1:${port}/ready`)).text();
        } catch {
          return started.output();
        }
      })
      .toBe("ready");
    const exited = once(started.child, "exit");
    started.child.kill(signal);
    expect((await exited)[0]).toBe(status);
    expect(started.output()).toContain("\u001b[31mStopping...\u001b[39m");
    if (kind !== "default")
      expect(started.output()).toContain(`cleanup:${signal === "SIGINT" ? 130 : 143}`);
    if (kind === "failure") expect(started.output()).toContain("cleanup failed");
    await expect(fetch(`http://127.0.0.1:${port}/ready`)).rejects.toThrow();
  },
);

const server = {
  "src/server/index.ts": `import { startServer } from "@prinpo/stack/server"; await startServer(() => import("./app"), {env:{client:false}});`,
  "src/server/app.ts": `import { Elysia, t } from "@prinpo/stack/server";
import { SQL } from "bun"; import { drizzle } from "@prinpo/stack/database/bun-sql/sqlite";
import { ENV } from "@prinpo/stack/env"; import { messages } from "../../schema";
await Bun.write("app-imported", "yes");
const client = new SQL(ENV.DATABASE_URL); const db = drizzle({client});
await db.select().from(messages);
export const app = new Elysia().get("/api/messages", () => db.select().from(messages))
.post("/api/messages", ({body}) => db.insert(messages).values(body).returning(), {body:t.Object({text:t.String()})})
.onStop(async () => { await client.close(); });`,
};

test("startServer finishes one asynchronous shutdown action when another signal arrives", async () => {
  const cwd = await project({
    "src/server/index.ts": `import{startServer}from"@prinpo/stack/server";const app=await startServer(()=>import("./app"),{env:{client:false},onStop:async()=>{await app.stop();console.log("listener stopped");await Bun.sleep(400);console.log("cleanup complete");}});`,
    "src/server/app.ts": `import{Elysia}from"@prinpo/stack/server";export const app=new Elysia().get("/ready",()=>"ready");`,
  });
  const port = await freePort();
  const started = launch(
    cwd,
    ["src/server/index.ts"],
    { PORT: String(port), NODE_ENV: "development" },
    true,
  );
  await expect
    .poll(async () => {
      try {
        return await (await fetch(`http://127.0.0.1:${port}/ready`)).text();
      } catch {
        return started.output();
      }
    })
    .toBe("ready");
  const exited = once(started.child, "exit");
  started.child.kill("SIGTERM");
  await expect.poll(started.output).toContain("listener stopped");
  started.child.kill("SIGINT");
  expect((await exited)[0]).toBe(143);
  expect(started.output()).toContain("cleanup complete");
  expect(started.output().match(/Stopping\.\.\./g)).toHaveLength(1);
});

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
    "src/index.html": "<html><head></head><body>Clean build</body></html>",
    "drizzle.config.ts": config.replace('"@prinpo/stack/env"', '"./src/env-gen/server"'),
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# @generateTsTypes(path=../../src/env-gen/server.ts,exposeEnv=local,icons=false)\n# ---\n# @dynamic @required\nDATABASE_URL=exec(`printf resolved > provider-ran; exit 97`)\n",
    "migrations/20261105000000_initial/migration.sql": "CREATE TABLE messages (id INTEGER);",
  });
  const built = run(cwd, ["build"]);
  expect(built.status, built.stdout + built.stderr).toBe(0);
  expect(await readFile(join(cwd, "src/env-gen/server.ts"), "utf8")).toContain("DATABASE_URL");
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
    "src/index.html": "<html><head></head><body>Database ready</body></html>",
    "drizzle.config.ts": config,
    "schema.ts": schema,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nHOST=exec(`printf h >> connection-resolutions; printf 127.0.0.1`)\n# @dynamic\nDATABASE_URL=exec(`printf x >> resolutions; printf sqlite://frontend.sqlite`)\n",
  });
  expect(run(cwd, ["db", "generate"]).status).toBe(0);
  const built = run(cwd, ["build"]);
  expect(built.status, built.stdout + built.stderr).toBe(0);
  for (const name of ["drizzle.config.ts", "schema.ts", "migrations", "src/index.html"])
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

test("the full-stack example upgrades old notes and loads notebook relations in both directions", async () => {
  const exampleNotebooks = pathToFileURL(
    resolve("examples/fullstack/src/server/routes/notebooks.ts"),
  ).href;
  const exampleNotes = pathToFileURL(resolve("examples/fullstack/src/server/routes/notes.ts")).href;
  const exampleDatabase = pathToFileURL(
    resolve("examples/fullstack/src/server/database/index.ts"),
  ).href;
  const cwd = await project({
    "drizzle.config.ts": config,
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nDATABASE_URL=sqlite://example.sqlite\n# @public @dynamic\nLOG_DIR=.evlog/logs\n",
    "src/server/app.ts": `import {Elysia} from "@prinpo/stack/server";import {notebookRoutes} from ${JSON.stringify(exampleNotebooks)};import {noteRoutes} from ${JSON.stringify(exampleNotes)};export const app=new Elysia().use(notebookRoutes).use(noteRoutes);`,
    "src/server/index.ts": `import {startServer} from "@prinpo/stack/server";const app=await startServer(()=>import("./app"),{env:{client:false},onStop:async()=>{try{await app.stop();}finally{const{client}=await import(${JSON.stringify(exampleDatabase)});await client.close();}}});`,
    "legacy.ts": `import{SQL}from"bun";const client=new SQL("sqlite://example.sqlite");await client\`INSERT INTO notes (text) VALUES ('legacy note')\`;await client.close();`,
  });
  const migrationRoot = resolve("examples/fullstack/migrations");
  const migrations = (await readdir(migrationRoot)).sort();
  await cp(join(migrationRoot, migrations[0]), join(cwd, "migrations", migrations[0]), {
    recursive: true,
  });
  const migrated = run(cwd, ["db", "migrate"]);
  expect(migrated.status, migrated.stdout + migrated.stderr).toBe(0);
  const seeded = spawnSync("bun", ["--no-env-file", "legacy.ts"], { cwd, encoding: "utf8" });
  expect(seeded.status, seeded.stderr).toBe(0);
  await cp(migrationRoot, join(cwd, "migrations"), { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const started = launch(
    cwd,
    ["src/server/index.ts"],
    { PORT: String(port), NODE_ENV: "production" },
    true,
  );
  await expect
    .poll(
      async () => {
        try {
          return await (await fetch(origin + "/api/notes")).json();
        } catch {
          return started.output();
        }
      },
      { timeout: 10_000 },
    )
    .toEqual([{ id: 1, text: "legacy note", notebookId: null, notebook: null }]);
  const post = async (path: string, body: unknown) => {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  expect(await post("/api/notebooks", { name: "  Work  ", id: 999 })).toEqual([
    { id: 1, name: "Work" },
  ]);
  for (const name of ["", "   ", "x".repeat(101)]) {
    const rejected = await fetch(origin + "/api/notebooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    expect(rejected.status).toBe(422);
  }
  expect(await post("/api/notes", { text: "related note", notebookId: 1 })).toEqual([
    { id: 2, text: "related note", notebookId: 1 },
  ]);
  expect(await (await fetch(origin + "/api/notebooks")).json()).toEqual([
    { id: 1, name: "Work", notes: [{ id: 2, text: "related note", notebookId: 1 }] },
  ]);
  expect(await (await fetch(origin + "/api/notes")).json()).toEqual([
    { id: 1, text: "legacy note", notebookId: null, notebook: null },
    { id: 2, text: "related note", notebookId: 1, notebook: { id: 1, name: "Work" } },
  ]);
}, 30_000);
