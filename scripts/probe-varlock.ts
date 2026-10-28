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
    '<html><script type="module" src="/main.js"></script></html>',
  );
  await writeFile(
    join(root, "main.js"),
    `import { loadPublicDynamicEnv } from "@prinpo/stack/env";
globalThis.__stackVarlockProbe = (async () => {
  let initializedBeforeRetry = false;
  try {
    await loadPublicDynamicEnv({ fetch: async () => new Response(null, { status: 503 }) });
    await import("./application.js");
  } catch {
    initializedBeforeRetry = !!globalThis.__stackApplication;
  }
  await loadPublicDynamicEnv({ fetch: async () => Response.json({
    STACK_PROBE_RUNTIME: globalThis.__stackDeployment,
    STACK_PROBE_UNDECLARED: "unexpected",
  }) });
  await import("./application.js");
  return { ...globalThis.__stackApplication, initializedBeforeRetry };
})();
`,
  );
  await writeFile(
    join(root, "application.js"),
    `import { ENV, getPublicDynamicConfigKeys } from "@prinpo/stack/env";
let undeclared;
try { undeclared = ENV.STACK_PROBE_UNDECLARED; } catch { undeclared = "rejected"; }
globalThis.__stackApplication = {
  staticValue: ENV.STACK_PROBE_STATIC,
  valueAtImport: ENV.STACK_PROBE_RUNTIME,
  keys: getPublicDynamicConfigKeys(),
  undeclared,
};
`,
  );

  const build = execute([vp, "build", "--configLoader", "runner"]);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const assets = join(root, "dist/assets");
  const html = await readFile(join(root, "dist/index.html"), "utf8");
  const entryName = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(entryName, "Missing browser entry in emitted HTML");
  const entry = join(root, "dist", entryName);
  const outcomes: unknown[] = [];
  for (const deployment of ["deployment-A", "deployment-B"]) {
    const hydration = execute([
      "--eval",
      `const { Window } = await import(${JSON.stringify(happyDom)});
const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;
globalThis.__stackDeployment = ${JSON.stringify(deployment)};
await import(${JSON.stringify(entry)});
console.log(JSON.stringify(await globalThis.__stackVarlockProbe));
await window.happyDOM.close();`,
    ]);
    assert.equal(hydration.status, 0, hydration.stderr);
    const result: unknown = JSON.parse(hydration.stdout.trim().split("\n").at(-1) ?? "null");
    assert.deepEqual(result, {
      staticValue: "fixed-metadata",
      valueAtImport: deployment,
      keys: ["STACK_PROBE_RUNTIME"],
      undeclared: "rejected",
      initializedBeforeRetry: false,
    });
    outcomes.push(result);
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
const server = await createServer({ configFile: false, plugins: [varlockVitePlugin()], server: { host: "127.0.0.1", port: 0 } });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  await fetch(new URL("/main.js", origin));
  const initial = await (await fetch(new URL("/application.js", origin))).text();
  if (!initial.includes('"fixed-metadata"')) throw new Error("Missing initial static replacement");
  await writeFile(".env.schema", (await readFile(".env.schema", "utf8")).replace("fixed-metadata", "fixed-reloaded"));
  let updated = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const code = await (await fetch(new URL("/application.js", server.resolvedUrls.local[0]))).text();
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
