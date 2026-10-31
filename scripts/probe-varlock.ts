import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Real emitted modules with happy-dom globals; this is not browser E2E.
const root = await mkdtemp(join(process.cwd(), ".stack-test-varlock-"));
const vp = resolve("node_modules/vite-plus/bin/vp");
const happyDom = resolve("node_modules/happy-dom/lib/index.js");
const baseEnv: NodeJS.ProcessEnv = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(baseEnv)) {
  if (key.startsWith("STACK_PROBE_") || key.startsWith("_VARLOCK") || key.startsWith("__VARLOCK"))
    delete baseEnv[key];
}

function execute(args: string[], env: NodeJS.ProcessEnv = baseEnv) {
  const result = spawnSync(process.execPath, ["--no-env-file", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Probe process terminated with ${result.signal}`);
  return result;
}

try {
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(root, ".env.schema"),
    "# @defaultSensitive=true\n# @redact=false @preventLeaks=false\n# @import(./.env.shared)\n# ---\n" +
      "# @public\nSTACK_PROBE_STATIC=fixed-metadata\n",
  );
  await writeFile(
    join(root, ".env.shared"),
    "# @defaultSensitive=true\n# ---\n# @public @dynamic @required\nSTACK_PROBE_RUNTIME=\n",
  );
  await writeFile(
    join(root, "vite.config.ts"),
    'import { defineConfig } from "vite-plus";\n' +
      'import { varlockVitePlugin } from "@prinpo/stack/env/vite";\n' +
      "export default defineConfig({ plugins: [varlockVitePlugin()], build: { modulePreload: false } });\n",
  );
  await writeFile(
    join(root, "index.html"),
    '<html><head></head><body><script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(
    join(root, "main.js"),
    `import { ENV } from "@prinpo/stack/env";
import { valueAtImport } from "./early.js";
globalThis.__stackLazy = import("./lazy.js");
let undeclared;
try { undeclared = ENV.STACK_PROBE_UNDECLARED; } catch { undeclared = "rejected"; }
globalThis.__stackApplication = {
  staticValue: ENV.STACK_PROBE_STATIC,
  valueAtImport,
  keys: globalThis.__varlockPublicDynamicKeys,
  undeclared,
};
`,
  );

  await writeFile(
    join(root, "early.js"),
    'import { ENV } from "@prinpo/stack/env"; export const valueAtImport = ENV.STACK_PROBE_RUNTIME;',
  );
  await writeFile(
    join(root, "lazy.js"),
    'import { ENV } from "@prinpo/stack/env"; export const value = ENV.STACK_PROBE_RUNTIME;',
  );

  const build = execute([vp, "build", "--configLoader", "runner"]);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const assets = join(root, "dist/assets");
  const html = await readFile(join(root, "dist/index.html"), "utf8");
  const entryName = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(entryName, "Missing browser entry in emitted HTML");
  const entry = join(root, "dist", entryName);
  const outcomes: unknown[] = [];
  for (const deployment of [
    "deployment-A",
    "deployment-B",
    "</script><script>globalThis.pwned=true</script>\u2028&",
  ]) {
    const serving = execute(
      [
        resolve("node_modules/varlock/bin/cli.js"),
        "run",
        "--",
        "bun",
        "--no-env-file",
        "--eval",
        `import { Elysia, startServer } from "@prinpo/stack/server";
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
process.env.PORT = String(reservation.port);
await reservation.stop();
const app = await startServer(async () => ({ app: new Elysia() }), { env: { server: ".", client: "." } });
try {
  await app.modules;
  const documents = [];
  for (const path of ["/", "/index.html", "/projects/123"]) {
    const response = await fetch(new URL(path, app.server.url), { headers: { Accept: "text/html" } });
    if (response.status !== 200 || response.headers.get("cache-control") !== "no-store") throw new Error("Bad document response");
    documents.push(await response.text());
    const head = await fetch(new URL(path, app.server.url), { method: "HEAD", headers: { Accept: "text/html" } });
    if (head.status !== 200 || await head.text() !== "") throw new Error("Bad HEAD response");
  }
  if (!documents.every((html) => html === documents[0])) throw new Error("Inconsistent application documents");
  console.log(JSON.stringify(documents[0]));
} finally { await app.stop(); }`,
      ],
      { ...baseEnv, NODE_ENV: "production", STACK_PROBE_RUNTIME: deployment },
    );
    assert.equal(serving.status, 0, serving.stdout + serving.stderr);
    const document = JSON.parse(serving.stdout.trim().split("\n").at(-1) ?? "null");
    const bootScript = document.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(bootScript, "Missing startup configuration");
    const hydration = execute([
      "--eval",
      `const { Window } = await import(${JSON.stringify(happyDom)});
const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;
new Function(${JSON.stringify(bootScript)})();
globalThis.fetch = () => { throw new Error("Browser configuration must not use fetch"); };
await import(${JSON.stringify(entry)});
if ((await globalThis.__stackLazy).value !== ${JSON.stringify(deployment)}) throw new Error("Split module missed configuration");
if (globalThis.pwned) throw new Error("Configuration executed markup");
console.log(JSON.stringify(globalThis.__stackApplication));
await window.happyDOM.close();`,
    ]);
    assert.equal(hydration.status, 0, hydration.stderr);
    const result: unknown = JSON.parse(hydration.stdout.trim().split("\n").at(-1) ?? "null");
    assert.deepEqual(result, {
      staticValue: "fixed-metadata",
      valueAtImport: deployment,
      keys: ["STACK_PROBE_RUNTIME"],
      undeclared: "rejected",
    });
    outcomes.push(result);
    assert.equal(
      await readFile(join(root, "dist/index.html"), "utf8"),
      html,
      "Serving must not mutate the artifact",
    );
  }
  const scripts = await Promise.all(
    (await readdir(assets))
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFile(join(assets, file), "utf8")),
  );
  for (const code of scripts)
    assert.ok(!code.includes("deployment-A") && !code.includes("deployment-B"));

  await writeFile(
    join(root, "dev-check.mjs"),
    `import { createServer } from "vite";
import { varlockVitePlugin } from "@prinpo/stack/env/vite";
import { readFile, writeFile } from "node:fs/promises";
const value = '</script><script>globalThis.pwned=true</script>\\u2028&';
await writeFile(".env.development", "STACK_PROBE_RUNTIME=" + JSON.stringify(value));
const server = await createServer({ configFile: false, plugins: [varlockVitePlugin()], server: { host: "127.0.0.1", port: 0 } });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  for (const path of ["/", "/projects/123"]) {
    const response = await fetch(new URL(path, origin));
    const html = await response.text();
    const script = html.match(/<script>([\\s\\S]*?)<\\/script>/)?.[1];
    if (!script || script.includes("</script>")) throw new Error("Missing or unsafe development configuration");
    new Function(script)();
    if (globalThis.__varlockPublicDynamicEnv.STACK_PROBE_RUNTIME !== value || globalThis.pwned) throw new Error("Invalid injected value");
    if (html.indexOf(script) > html.indexOf('src="/main.js"')) throw new Error("Configuration follows app entry");
  }
  const initial = await (await fetch(new URL("/main.js", origin))).text();
  if (!initial.includes('"fixed-metadata"')) throw new Error("Missing initial static replacement");
  await writeFile(".env.schema", (await readFile(".env.schema", "utf8")).replace("fixed-metadata", "fixed-reloaded"));
  let updated = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const code = await (await fetch(new URL("/main.js", server.resolvedUrls.local[0]))).text();
      if (code.includes('"fixed-reloaded"')) { updated = true; break; }
    } catch { /* the native watcher may be restarting the listener */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!updated) throw new Error("Schema edit did not refresh static configuration");
} finally { await server.close(); }
`,
  );
  const dev = execute(["dev-check.mjs"]);
  assert.equal(dev.status, 0, dev.stdout + dev.stderr);
  await writeFile(
    join(root, ".env.shared"),
    "# @defaultSensitive=true\n# ---\nSTACK_PROBE_TOKEN=exec(`exit 97`)\n",
  );
  const sensitiveImport = execute([vp, "build", "--configLoader", "runner"]);
  assert.equal(sensitiveImport.status, 1);
  assert.match(
    sensitiveImport.stderr,
    /Client configuration contains sensitive item STACK_PROBE_TOKEN/,
  );
  await writeFile(
    join(root, ".env.shared"),
    "# @defaultSensitive=false\n# ---\nSTACK_PROBE_UNMARKED=metadata\n",
  );
  const unmarkedImport = execute([vp, "build", "--configLoader", "runner"]);
  assert.equal(unmarkedImport.status, 1);
  assert.match(unmarkedImport.stderr, /must explicitly declare @public/);
  console.log(
    JSON.stringify(
      {
        bun: Bun.version,
        deploymentArtifactBuildCount: 1,
        deployments: outcomes,
        schemaReload: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
