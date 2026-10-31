import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

const cli = resolve("src/cli/main.ts");
const directories: string[] = [];
const processes: ReturnType<typeof spawn>[] = [];
afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(files: Record<string, string> = {}) {
  const cwd = await mkdtemp(join(process.cwd(), ".stack-test-cli-"));
  directories.push(cwd);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(cwd, path, ".."), { recursive: true });
    await writeFile(join(cwd, path), content);
  }
  return cwd;
}

function cliEnvironment(overrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "1", NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (/^(?:_+VARLOCK|NODE_ENV$|APP_ENV$|HOST$|PORT$|LOG_DIR$|CLI_)/.test(key)) delete env[key];
  }
  return { ...env, ...overrides };
}

function run(cwd: string, args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync("bun", ["--no-env-file", cli, ...args], {
    cwd,
    env: cliEnvironment(overrides),
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("doctor explains inferred capabilities without resolving application credentials", async () => {
  const cwd = await project({
    "index.html": "<html><head></head></html>",
    "env/server/.env.schema": "# @required\nCLI_SECRET=exec(`exit 97`)\n",
  });
  const result = run(cwd, ["doctor", "--json"]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    frontend: { enabled: true, reason: "Found index.html" },
    backend: { enabled: false, reason: "Missing src/server/index.ts" },
    env: { client: false, server: true },
  });
});

test("environment loading composes owned defaults and selects staging independently of NODE_ENV", async () => {
  const cwd = await project({
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public\nCLI_NAME=default\n",
    "env/server/.env.staging": "CLI_NAME=staging-value\n",
  });
  const result = run(cwd, ["env", "load", "--env", "staging", "--format", "json"], {
    NODE_ENV: "production",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    HOST: "127.0.0.1",
    PORT: 3000,
    NODE_ENV: "production",
    APP_ENV: "staging",
    CLI_NAME: "staging-value",
  });
});

test("env run reuses its validated server graph and hydrates the independently selected client profile", async () => {
  const cwd = await project({
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic\nCLI_SERVER=exec(`printf x >> resolutions; printf ready`)\n",
    "env/client/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic @required\nCLI_CLIENT=\n",
    "env/client/.env.staging": "CLI_CLIENT=staging-client\n",
  });
  const result = run(
    cwd,
    [
      "env",
      "run",
      "--env",
      "staging",
      "--",
      "bun",
      "--no-env-file",
      "--eval",
      'const { loadServerEnv } = await import("@prinpo/stack/env/server"); const config = await loadServerEnv(); console.log(JSON.stringify({ mode: config.mode, profile: config.profile, client: config.clientValues, count: await Bun.file("resolutions").text() }));',
    ],
    { NODE_ENV: "production" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({
    mode: "production",
    profile: "staging",
    client: { CLI_CLIENT: "staging-client" },
    count: "x",
  });
});

test("logs uses profile-specific LOG_DIR without resolving unrelated credentials", async () => {
  const cwd = await project({
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic\nLOG_DIR=.evlog/logs\nCLI_SECRET=exec(`exit 97`)\n",
    "env/server/.env.staging": "LOG_DIR=staging-logs\n",
    "staging-logs/2026-10-31.jsonl":
      JSON.stringify({
        timestamp: "2026-10-31T10:00:00.000Z",
        level: "error",
        service: "fixture",
        environment: "production",
        message: "failed request",
        requestId: "request-42",
      }) + "\n",
  });
  const result = run(cwd, ["logs", "errors", "--env", "staging", "--json"]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    count: 1,
    events: [{ requestId: "request-42" }],
  });
});

test("backend builds clear stale frontend output and start from a successful manifest without sources", async () => {
  const cwd = await project({
    "src/server/index.ts":
      "console.log(JSON.stringify({ runtime: !!process.versions.bun, mode: process.env.NODE_ENV, profile: process.env.APP_ENV }));",
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @required\nCLI_SECRET=exec(`exit 97`)\n",
    "dist/client/index.html": "stale frontend",
  });
  const build = run(cwd, ["build"]);
  expect(build.status, build.stdout + build.stderr).toBe(0);
  expect(JSON.parse(await readFile(join(cwd, "dist/manifest.json"), "utf8"))).toMatchObject({
    version: 1,
    frontend: false,
    backend: true,
  });
  await expect(readFile(join(cwd, "dist/client/index.html"), "utf8")).rejects.toThrow();
  await rm(join(cwd, "src"), { recursive: true });
  const start = run(cwd, ["start", "--env", "staging"]);
  expect(start.status, start.stderr).toBe(0);
  expect(JSON.parse(start.stdout)).toEqual({
    runtime: true,
    mode: "production",
    profile: "staging",
  });
});

test("a failed rebuild invalidates the previous manifest and cannot start partial output", async () => {
  const cwd = await project({ "src/server/index.ts": 'console.log("built");' });
  expect(run(cwd, ["build"]).status).toBe(0);
  await writeFile(join(cwd, "src/server/index.ts"), "this is not typescript !!!");
  const failed = run(cwd, ["build"]);
  expect(failed.status).not.toBe(0);
  expect(failed.stdout).not.toContain("Build complete");
  const result = run(cwd, ["start"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Run stack build");
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

function launch(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn("bun", ["--no-env-file", cli, ...args], {
    cwd,
    env: cliEnvironment(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);
  let output = "";
  child.stdout?.on("data", (data) => {
    output += data;
  });
  child.stderr?.on("data", (data) => {
    output += data;
  });
  return { child, output: () => output };
}

test("frontend-only production startup hydrates staging values without backend credentials or sources", async () => {
  const cwd = await project({
    "index.html": "<html><head></head><body>Built frontend</body></html>",
    "public/asset.txt": "static asset",
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\nCLI_SECRET=exec(`exit 97`)\n",
    "env/client/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic @required\nCLI_PUBLIC=\n",
    "env/client/.env.staging": "CLI_PUBLIC=staging-public\n",
  });
  const result = run(cwd, ["build"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  await rm(join(cwd, "index.html"));
  const port = await freePort();
  const app = launch(cwd, ["start", "--env", "staging"], { PORT: String(port) });
  const origin = `http://127.0.0.1:${port}`;
  await expect
    .poll(async () => {
      try {
        return (await fetch(origin)).status;
      } catch {
        return app.output();
      }
    })
    .toBe(200);
  const html = await fetch(origin + "/nested/route", { headers: { accept: "text/html" } });
  expect(await html.text()).toContain("staging-public");
  expect(html.headers.get("cache-control")).toBe("no-store");
  expect(await (await fetch(origin + "/asset.txt")).text()).toBe("static asset");
  const head = await fetch(origin + "/index.html", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect((await fetch(origin + "/missing.js", { headers: { accept: "text/html" } })).status).toBe(
    404,
  );
  expect((await fetch(origin + "/api/missing", { headers: { accept: "text/html" } })).status).toBe(
    404,
  );
  expect(await readFile(join(cwd, "dist/client/index.html"), "utf8")).not.toContain(
    "staging-public",
  );
}, 30_000);

test("client compilation uses APP_ENV independently of Vite mode and stays on Bun", async () => {
  const cwd = await project({
    "index.html":
      '<html><head></head><body><script type="module" src="/main.ts"></script></body></html>',
    "main.ts":
      'import { ENV } from "@prinpo/stack/env"; document.body.textContent = ENV.CLI_STATIC + ":" + import.meta.env.MODE;',
    "vite.config.ts":
      'import { defineConfig } from "vite-plus"; import { varlockVitePlugin } from "@prinpo/stack/env/vite"; if (!process.versions.bun) throw new Error("Tooling ran on Node"); export default defineConfig({ mode: "review", plugins: [varlockVitePlugin()], build: { minify: false } });',
    "env/client/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @required\nCLI_STATIC=\n# @public @dynamic\nCLI_RUNTIME=exec(`exit 97`)\n",
    "env/client/.env.staging": "CLI_STATIC=staging-static\n",
    "env/client/.env.production": "CLI_STATIC=wrong-profile\n",
  });
  const result = run(cwd, ["build", "--env", "staging"]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const assets = join(cwd, "dist/client/assets");
  const files = await readdir(assets);
  const source = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFile(join(assets, file), "utf8")),
    )
  ).join("\n");
  expect(source).toContain("staging-static");
  expect(source).toContain("review");
  expect(source).not.toContain("wrong-profile");
});

test("development restarts frontend and backend on server env changes and cleans up both on termination", async () => {
  const backendPort = await freePort();
  const frontendPort = await freePort();
  const cwd = await project({
    "index.html": "<html><head></head><body>Development</body></html>",
    "package.json": '{"type":"module"}',
    "src/routes/__root.tsx":
      'import { createRootRoute } from "@prinpo/stack/react"; export const Route = createRootRoute();',
    "vite.config.ts": `import { defineConfig } from "vite-plus"; import { stack } from "@prinpo/stack/vite"; export default defineConfig({ plugins: [stack({ api: true }), { name: "fixture-pid", configureServer(server) { server.middlewares.use("/frontend-pid", (_, res) => { res.end(String(process.pid)); }); } }], server: { host: "127.0.0.1", port: ${frontendPort}, strictPort: true } });`,
    "src/server/index.ts":
      'import { startServer } from "@prinpo/stack/server"; await startServer(() => import("./app"));',
    "src/server/app.ts":
      'import { Elysia } from "@prinpo/stack/server"; import { ENV } from "@prinpo/stack/env"; export const app = new Elysia().get("/api/health", () => ({ pid: process.pid, value: ENV.CLI_VALUE }));',
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic\nCLI_VALUE=\n",
    "env/server/.env.development": `PORT=${backendPort}\nCLI_VALUE=first\n`,
  });
  const app = launch(cwd, ["dev"], {});
  const origin = `http://127.0.0.1:${frontendPort}`;
  async function health() {
    try {
      return await (await fetch(origin + "/api/health")).json();
    } catch {
      return null;
    }
  }
  await expect
    .poll(async () => (await health())?.value ?? app.output(), { timeout: 10_000 })
    .toBe("first");
  const before = await health();
  expect(app.output()).toContain("[frontend]");
  expect(app.output()).toContain("[backend]");
  const frontendBefore = await (await fetch(origin + "/frontend-pid")).text();
  const nextPort = await freePort();
  await writeFile(join(cwd, "env/server/.env.development"), `PORT=${nextPort}\nCLI_VALUE=second\n`);
  await expect.poll(async () => (await health())?.value, { timeout: 10_000 }).toBe("second");
  expect((await health()).pid).not.toBe(before.pid);
  expect(await (await fetch(origin + "/frontend-pid")).text()).not.toBe(frontendBefore);
  app.child.kill("SIGTERM");
  await once(app.child, "exit");
  await expect(fetch(origin)).rejects.toThrow();
  await expect(fetch(`http://127.0.0.1:${nextPort}/api/health`)).rejects.toThrow();
}, 45_000);

test("frontend builds validate client schemas even when native Vite configuration omits env plugins", async () => {
  const cwd = await project({
    "index.html": "<html><head></head><body>Frontend</body></html>",
    "env/client/.env.schema":
      "# @defaultSensitive=true\n# ---\nCLI_SECRET=exec(`printf exposed > resolver-ran; printf secret`)\n",
  });
  const result = run(cwd, ["build"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("sensitive item CLI_SECRET");
  await expect(readFile(join(cwd, "resolver-ran"))).rejects.toThrow();
  await expect(readFile(join(cwd, "dist/manifest.json"))).rejects.toThrow();
});

test("client inspection rejects secrets before executing their value resolvers", async () => {
  const cwd = await project({
    "env/client/.env.schema":
      "# @defaultSensitive=true\n# ---\nCLI_SECRET=exec(`printf exposed > resolver-ran; printf secret`)\n",
  });
  const result = run(cwd, ["env", "load", "--client", "--agent"]);
  expect(result.status).not.toBe(0);
  await expect(readFile(join(cwd, "resolver-ran"))).rejects.toThrow();
});

test("codegen skips missing optional schemas but fails explicit missing selections without resolving values", async () => {
  const cwd = await project({
    "env/client/.env.schema":
      "# @redact=false @preventLeaks=false\n# @generateTsTypes(path=../../client-env.ts,exposeEnv=local,icons=false)\n# ---\n# @public @dynamic @required\nCLI_PUBLIC=exec(`printf resolved > resolver-ran; printf value`)\n",
  });
  const result = run(cwd, ["env", "codegen"]);
  expect(result.status, result.stderr).toBe(0);
  expect(await readFile(join(cwd, "client-env.ts"), "utf8")).toContain("CLI_PUBLIC");
  await expect(readFile(join(cwd, "resolver-ran"))).rejects.toThrow();
  const missing = run(cwd, ["env", "codegen", "--server"]);
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain("Selected schema does not exist: env/server");
});

test("explicit log directories bypass even malformed environment schemas", async () => {
  const cwd = await project({
    "env/server/.env.schema": "# @import(./does-not-exist)\n# ---\n",
    "saved/2026-10-31.jsonl": "",
  });
  const result = run(cwd, ["logs", "--dir", "saved", "--json"]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ count: 0, events: [] });
});

test("env run preserves child help arguments and native exit statuses", async () => {
  const cwd = await project({
    "command.ts":
      "console.log(JSON.stringify({ host: process.env.HOST, args: process.argv.slice(2) })); process.exit(7);",
  });
  const result = run(cwd, ["env", "run", "--", "bun", "--no-env-file", "command.ts", "--help"]);
  expect(result.status, result.stdout + result.stderr).toBe(7);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ host: "127.0.0.1", args: ["--help"] });
});

test("doctor returns structured reasons and a failing status when neither entry exists", async () => {
  const cwd = await project();
  const result = run(cwd, ["doctor", "--json"]);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    frontend: { enabled: false },
    backend: { enabled: false },
  });
});

test("server codegen includes Stack settings and stays stable across builds", async () => {
  const cwd = await project({
    "src/server/index.ts": 'console.log("backend");',
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# @generateTsTypes(path=../../server-env.ts,exposeEnv=local,icons=false)\n# ---\n# @public\nAPP_NAME=fixture\n",
  });
  const generated = run(cwd, ["env", "codegen", "--server"]);
  expect(generated.status, generated.stderr).toBe(0);
  const before = await readFile(join(cwd, "server-env.ts"), "utf8");
  expect(before).toContain("APP_ENV: string");
  expect(before).toContain("HOST: string");
  const built = run(cwd, ["build"]);
  expect(built.status, built.stderr).toBe(0);
  expect(await readFile(join(cwd, "server-env.ts"), "utf8")).toBe(before);
});

test("command help includes Stack selectors and native options without loading schemas", async () => {
  const cwd = await project({ "env/server/.env.schema": "# @import(./missing)\n# ---\n" });
  const result = run(cwd, ["env", "load", "--help"]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("--client");
  expect(result.stdout).toContain("--agent");
  expect(run(cwd, ["doctor", "--help"]).status).toBe(0);
});

test("unknown root options fail instead of silently succeeding", async () => {
  const result = run(await project(), ["--unknown"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Unknown");
});

test("an unexpected frontend exit fails development and stops the backend watcher", async () => {
  const backendPort = await freePort();
  const frontendPort = await freePort();
  const cwd = await project({
    "index.html": "<html><head></head><body>Fixture</body></html>",
    "src/server/index.ts": `Bun.serve({ hostname: "127.0.0.1", port: ${backendPort}, fetch: () => new Response("backend") }); console.log("BACKEND_READY");`,
    "vite.config.ts": `export default { plugins: [{ name: "fixture-exit", configureServer() { setTimeout(() => process.exit(9), 300); } }], server: { host: "127.0.0.1", port: ${frontendPort} } };`,
  });
  const app = launch(cwd, ["dev"], {});
  const [status] = await once(app.child, "exit");
  expect(status, app.output()).toBe(9);
  expect(app.output()).toContain("BACKEND_READY");
  await expect(fetch(`http://127.0.0.1:${backendPort}`)).rejects.toThrow();
  await expect(fetch(`http://127.0.0.1:${frontendPort}`)).rejects.toThrow();
}, 20_000);

test("explicit startup selection discards incompatible inherited snapshots while preserving genuine overrides", async () => {
  const cwd = await project({
    "src/server/index.ts":
      'const { loadServerEnv } = await import("@prinpo/stack/env/server"); const config = await loadServerEnv(); const { ENV } = await import("@prinpo/stack/env"); console.log(JSON.stringify({ mode: config.mode, profile: config.profile, value: ENV.CLI_VALUE, override: ENV.CLI_OVERRIDE }));',
    "env/server/.env.schema":
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic\nCLI_VALUE=\n# @public @dynamic\nCLI_OVERRIDE=\n",
    "env/server/.env.development":
      "CLI_VALUE=development-value\nCLI_OVERRIDE=development-default\n",
    "env/server/.env.staging": "CLI_VALUE=staging-value\nCLI_OVERRIDE=staging-default\n",
  });
  expect(run(cwd, ["build"]).status).toBe(0);
  const result = run(
    cwd,
    [
      "env",
      "run",
      "--env",
      "development",
      "--",
      "bun",
      "--no-env-file",
      cli,
      "start",
      "--env",
      "staging",
    ],
    { CLI_OVERRIDE: "caller-value" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toEqual({
    mode: "production",
    profile: "staging",
    value: "staging-value",
    override: "caller-value",
  });
});

test("startup rejects directories in place of advertised build artifacts with rebuild instructions", async () => {
  const cwd = await project({
    "dist/manifest.json": '{"version":1,"backend":true,"frontend":false}',
  });
  await mkdir(join(cwd, "dist/server/index.js"), { recursive: true });
  const result = run(cwd, ["start"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Run stack build");
});

test("development labels complete output lines on their original streams, including final fragments", async () => {
  const port = await freePort();
  const cwd = await project({
    "src/server/index.ts": `Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); process.stdout.write("split "); setTimeout(() => { process.stdout.write("message\\nfinal fragment"); process.stderr.write("warning\\n"); }, 25);`,
  });
  const app = launch(cwd, ["dev"], {});
  let stdout = "";
  let stderr = "";
  app.child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  app.child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  await expect.poll(() => stdout, { timeout: 5000 }).toContain("split message");
  app.child.kill("SIGTERM");
  await once(app.child, "close");
  expect(stdout).toMatch(/\[backend\]\s+split message\n/);
  expect(stdout).toMatch(/\[backend\]\s+final fragment\n/);
  expect(stderr).toMatch(/\[backend\]\s+warning\n/);
  expect(stdout).not.toContain("warning");
});

test("successful builds summarize the enabled area with measured artifact size, timings, and Stack version", async () => {
  const cwd = await project({ "src/server/index.ts": 'console.log("backend");' });
  const result = run(cwd, ["build"]);
  expect(result.status, result.stderr).toBe(0);
  const bytes = (await readFile(join(cwd, "dist/server/index.js"))).byteLength;
  expect(result.stdout).toContain("Build complete");
  expect(result.stdout).toContain("Stack v0.0.0");
  expect(result.stdout).toMatch(
    new RegExp(`Backend\\s+${bytes} B\\s+\\d+(?:\\.\\d+)? (?:ms|s)\\s+dist/server`),
  );
  expect(result.stdout).not.toContain("Frontend");
  expect(result.stdout).toMatch(/Total\s+\d+(?:\.\d+)? B\s+\d+(?:\.\d+)? (?:ms|s)/);
});
