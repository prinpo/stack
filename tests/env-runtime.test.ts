import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

const schema = "# @defaultSensitive=true\n# @redact=false @preventLeaks=false\n# ---\n";

async function runtime(files: Record<string, string>, source: string, cliPath?: string) {
  const cwd = await mkdtemp(join(process.cwd(), ".stack-test-runtime-"));
  try {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ type: "module", varlock: { loadPath: "./env/client" } }),
    );
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(cwd, name)), { recursive: true });
      await writeFile(join(cwd, name), content);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "1" };
    for (const key of Object.keys(env)) {
      if (
        ["HOST", "PORT", "NODE_ENV", "SHARED_SETTING"].includes(key) ||
        key.startsWith("_VARLOCK") ||
        key.startsWith("__VARLOCK")
      )
        delete env[key];
    }
    const args = cliPath
      ? [
          resolve("node_modules/varlock/bin/cli.js"),
          "run",
          "--path",
          cliPath,
          "--",
          "bun",
          "--no-env-file",
          "--eval",
          source,
        ]
      : ["--eval", source];
    return spawnSync("bun", ["--no-env-file", ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("Stack provides validated connection defaults without application schema declarations", async () => {
  const result = await runtime(
    {},
    `import { readServerConnection } from "@prinpo/stack/env/server";
console.log(JSON.stringify(await readServerConnection()));`,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ host: "127.0.0.1", port: 3000, mode: "development" });
});

test.each(["0", "65536", "not-a-port"])(
  "Stack rejects invalid PORT=%s before importing the application",
  async (port) => {
    const result = await runtime(
      { "env/server/.env": `PORT=${port}\n` },
      `import { startServer } from "@prinpo/stack/server";
await startServer(async () => { console.log("APPLICATION_IMPORTED"); throw new Error("unreachable"); });`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("APPLICATION_IMPORTED");
    expect(result.stderr).toContain("PORT");
  },
);

test("standard startup keeps independent schemas, initializes before app imports, and derives delivery automatically", async () => {
  const result = await runtime(
    {
      "env/server/.env": "NODE_ENV=production\n",
      "dist/index.html": "<html><head></head><body>Application</body></html>",
      "env/server/.env.schema":
        schema +
        "# @sensitive @dynamic\nSHARED_SETTING=server-private-value\n# @public @dynamic\nBACKEND_PUBLIC=backend-only-value\n",
      "env/client/.env.schema":
        schema +
        "# @public @dynamic\nSHARED_SETTING=client-public-value\n# @public @static\nCLIENT_STATIC=fixed-value\n",
      "app.ts": `import { ENV } from "@prinpo/stack/env";
import { Elysia } from "@prinpo/stack/server";
const valueAtImport = ENV.SHARED_SETTING;
export const app = new Elysia().get("/api/value", () => valueAtImport);`,
    },
    `import { startServer } from "@prinpo/stack/server";
import { writeFile } from "node:fs/promises";
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop();
await writeFile("env/server/.env.local", "PORT=" + port);
const app = await startServer(() => import("./app"));
try {
  const value = await (await fetch(new URL("/api/value", app.server.url))).text();
  const response = await fetch(new URL("/api/public-env", app.server.url));
  const { readClientEnv } = await import("@prinpo/stack/env/server");
  const localClient = await readClientEnv({ mode: "production" });
  const document = await fetch(app.server.url);
  const html = await document.text();
  console.log("RESULT=" + JSON.stringify({ value, localClient: localClient.clientValues.SHARED_SETTING, endpoint: response.status, client: html.includes("client-public-value"), leaked: html.includes("server-private-value") || html.includes("backend-only-value"), cache: document.headers.get("cache-control") }));
} finally { await app.stop(); }`,
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const line = result.stdout.split("\n").find((line) => line.startsWith("RESULT="));
  expect(line).toBeDefined();
  expect(JSON.parse(line?.slice(7) ?? "null")).toEqual({
    value: "server-private-value",
    endpoint: 404,
    localClient: "client-public-value",
    client: true,
    leaked: false,
    cache: "no-store",
  });
});

test("backend-only production startup does not require a browser build", async () => {
  const result = await runtime(
    {
      "env/server/.env.schema": schema,
      "app.ts":
        'import { Elysia } from "@prinpo/stack/server"; export const app = new Elysia().get("/api/health", () => "ok");',
    },
    `import { startServer } from "@prinpo/stack/server";
import { writeFile } from "node:fs/promises";
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop();
await writeFile("env/server/.env", "NODE_ENV=production\\nPORT=" + port);
const app = await startServer(() => import("./app"), { env: { client: false } });
try {
  const { ENV } = await import("@prinpo/stack/env");
  if (ENV.NODE_ENV !== "production") throw new Error("Wrong mode");
  if (await (await fetch(new URL("/api/health", app.server.url))).text() !== "ok") throw new Error("Missing route");
  console.log("BACKEND_ONLY_OK");
} finally { await app.stop(); }`,
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("BACKEND_ONLY_OK");
});

test("production HTML with no client dynamics never falls back to backend public values", async () => {
  const result = await runtime(
    {
      "env/server/.env": "NODE_ENV=production\n",
      "env/server/.env.schema": schema + "# @public @dynamic\nBACKEND_PUBLIC=must-not-leak\n",
      "env/client/.env.schema": schema + "# @public @static @required\nBUILD_ONLY=\n",
      "dist/index.html": "<html><head></head><body>Application</body></html>",
      "app.ts": 'import { Elysia } from "@prinpo/stack/server"; export const app = new Elysia();',
    },
    `import { startServer } from "@prinpo/stack/server";
import { writeFile } from "node:fs/promises";
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop();
await writeFile("env/server/.env.local", "PORT=" + port);
const app = await startServer(() => import("./app"));
try {
  const html = await (await fetch(app.server.url)).text();
  if (html.includes("must-not-leak") || !html.includes('JSON.parse("{}")')) throw new Error("Wrong empty client snapshot");
  console.log("EMPTY_CLIENT_OK");
} finally { await app.stop(); }`,
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("EMPTY_CLIENT_OK");
});

test("missing HTML head fails startup before opening a listener", async () => {
  const result = await runtime(
    {
      "env/server/.env": "NODE_ENV=production\n",
      "dist/index.html": "<html><body>Application</body></html>",
      "app.ts":
        'import { Elysia } from "@prinpo/stack/server"; export const app = new Elysia(); app.listen = () => { throw new Error("LISTENER_STARTED"); };',
    },
    'import { startServer } from "@prinpo/stack/server"; await startServer(() => import("./app"));',
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("requires an HTML head element");
  expect(result.stderr).not.toContain("LISTENER_STARTED");
});

test("development startup neither resolves client settings nor registers an environment endpoint", async () => {
  const result = await runtime(
    {
      "env/server/.env.schema": schema,
      "env/client/.env.schema": schema + "# @public @dynamic\nCLIENT_VALUE=exec(`exit 97`)\n",
      "app.ts":
        'import { Elysia } from "@prinpo/stack/server"; export const app = new Elysia().get("/api/health", () => "ok");',
    },
    `import { startServer } from "@prinpo/stack/server";
import { writeFile } from "node:fs/promises";
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop();
await writeFile("env/server/.env", "PORT=" + port);
const app = await startServer(() => import("./app"));
try {
  const response = await fetch(new URL("/api/public-env", app.server.url));
  if (response.status !== 404) throw new Error("Obsolete endpoint is registered");
  if (await (await fetch(new URL("/api/health", app.server.url))).text() !== "ok") throw new Error("Backend did not start");
  console.log("DEVELOPMENT_BACKEND_OK");
} finally { await app.stop(); }`,
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("DEVELOPMENT_BACKEND_OK");
});

test.each(["@dynamic", "@static"])(
  "client %s secrets are rejected before value resolvers execute",
  async (timing) => {
    const result = await runtime(
      { "env/client/.env.schema": schema + `# @sensitive ${timing}\nTOKEN=exec(\`exit 97\`)\n` },
      `import { readClientEnv } from "@prinpo/stack/env/server"; await readClientEnv();`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TOKEN must explicitly declare @public");
    expect(result.stderr).not.toContain("command failed");
  },
);

test("server startup resolves client dynamics without requiring build-only static values", async () => {
  const result = await runtime(
    {
      "env/client/.env.schema":
        schema +
        "# @public @static @required\nBUILD_ONLY=\n# @public @dynamic\nRUNTIME_VALUE=available\n",
    },
    `import { loadServerEnv } from "@prinpo/stack/env/server";
const first = loadServerEnv();
const second = loadServerEnv();
if (first !== second) throw new Error("Startup must share one promise");
if ((await first).clientKeys.length) throw new Error("Development backend must not resolve client env");
const { readClientEnv } = await import("@prinpo/stack/env/server");
console.log(JSON.stringify((await readClientEnv()).clientValues));`,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ RUNTIME_VALUE: "available" });
});

test("CLI snapshots reuse providers once without making server values override the client schema", async () => {
  const result = await runtime(
    {
      "env/server/.env.start":
        "# @currentEnv=$NODE_ENV\n# @import(./)\n# ---\n# @public @dynamic\nNODE_ENV=production\n",
      "env/server/.env.schema":
        schema +
        "SHARED_SETTING=exec(`printf x >> resolutions; printf synthetic-server-credential`)\n",
      "env/client/.env.schema":
        schema + "# @public @dynamic\nSHARED_SETTING=client-independent-value\n",
    },
    `import { loadServerEnv } from "@prinpo/stack/env/server";
import { readFile } from "node:fs/promises";
const config = await loadServerEnv();
const { ENV } = await import("@prinpo/stack/env");
console.log("RESULT=" + JSON.stringify({ mode: config.mode, server: ENV.SHARED_SETTING, client: config.clientValues, resolutions: await readFile("resolutions", "utf8") }));`,
    "env/server/.env.start",
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const line = result.stdout.split("\n").find((line) => line.startsWith("RESULT="));
  expect(JSON.parse(line?.slice(7) ?? "null")).toEqual({
    mode: "production",
    server: "synthetic-server-credential",
    client: { SHARED_SETTING: "client-independent-value" },
    resolutions: "x",
  });
});

test.each(["127.0.0.1", "0.0.0.0"])(
  "managed Vite reads backend HOST=%s for proxying and resolves client files without a running backend",
  async (host) => {
    const result = await runtime(
      {
        "env/server/.env.schema": schema + "# @required\nUNRELATED_SECRET=exec(`exit 97`)\n",
        "env/client/.env.schema": schema + "# @public @dynamic\nCLIENT_VALUE=\n",
        "env/client/.env.development": "CLIENT_VALUE=from-client-files\n",
        "index.html":
          '<html><head></head><body><script type="module" src="/main.js"></script></body></html>',
        "main.js": "export {};",
        "src/routes/__root.tsx":
          'import { createRootRoute } from "@prinpo/stack/react"; export const Route = createRootRoute();',
      },
      `import { createServer } from "vite";
import { stack } from "@prinpo/stack/vite";
import { writeFile } from "node:fs/promises";
const backend = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
  if (new URL(request.url).pathname === "/api/public-env") throw new Error("Unexpected environment request");
  return Response.json({ proxied: true });
} });
await writeFile("env/server/.env.development", "HOST=${host}\\nPORT=" + backend.port);
const server = await createServer({ configFile: false, plugins: [stack({ api: true })], server: { host: "127.0.0.1", port: 0 } });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const response = await fetch(new URL("/api/health", origin));
  if (!(await response.json()).proxied) throw new Error("Wrong proxy target");
  await backend.stop();
  const html = await (await fetch(origin)).text();
  if (!html.includes("from-client-files")) throw new Error("Missing configuration in document");
  console.log("MANAGED_VITE_OK");
} finally { await server.close(); await backend.stop(); }`,
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("MANAGED_VITE_OK");
  },
);
