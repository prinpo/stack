import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function load(
  schema: string,
  mode: "build" | "client" | "runtime" = "build",
  overrides: NodeJS.ProcessEnv = {},
) {
  const cwd = await createTestDirectory("env");
  directories.push(cwd);
  await writeFile(
    join(cwd, ".env.schema"),
    "# @defaultSensitive=true\n# @redact=false @preventLeaks=false\n# ---\n" + schema,
  );
  const env: NodeJS.ProcessEnv = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("_VARLOCK") || key.startsWith("__VARLOCK") || key.startsWith("STACK_ENV_"))
      delete env[key];
  }
  const args =
    mode === "runtime"
      ? [resolve("node_modules/varlock/bin/cli.js"), "load", "--format", "json-full"]
      : [
          "--eval",
          `import { loadStaticEnv } from ${JSON.stringify(resolve("src/env/server.ts"))};
console.log(JSON.stringify(await loadStaticEnv([process.cwd()], { publicOnly: ${mode === "client"} })));`,
        ];
  const result = spawnSync("bun", ["--no-env-file", ...args], {
    cwd,
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 15_000,
  });
  return { ...result, cwd };
}

test("builds validate static inputs and retain unresolved dynamic metadata", async () => {
  const result = await load(
    "# @public\nSTACK_ENV_NAME=app\n# @public @dynamic @required\nSTACK_ENV_ORIGIN=\n# @required\nSTACK_ENV_TOKEN=\n",
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    config: {
      STACK_ENV_NAME: { value: "app", isSensitive: false },
      STACK_ENV_ORIGIN: { isSensitive: false, isDynamic: true },
      STACK_ENV_TOKEN: { isSensitive: true },
    },
  });
  expect(result.stdout).not.toContain('"errors"');
});

test.each(["", "# @static\n"])(
  "client builds reject sensitive entries before resolving values (%s)",
  async (timing) => {
    const result = await load(timing + "STACK_ENV_TOKEN=exec(`exit 97`)\n", "client");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Client configuration contains sensitive item STACK_ENV_TOKEN");
  },
);

test("static inputs cannot depend on dynamic values", async () => {
  const result = await load("STACK_ENV_TOKEN=\n# @public\nSTACK_ENV_URL=${STACK_ENV_TOKEN}/api\n");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "Static item STACK_ENV_URL depends on dynamic item STACK_ENV_TOKEN",
  );
});

test("build classification does not resolve values to inspect metadata", async () => {
  const result = await load(
    "# @public\nSTACK_ENV_SWITCH=true\n# @sensitive=eq($STACK_ENV_SWITCH,true)\nSTACK_ENV_TOKEN=\n",
    "client",
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Value-dependent metadata on STACK_ENV_TOKEN");
});

test("invalid static configuration still fails the build", async () => {
  const result = await load("# @public @type=number\nSTACK_ENV_PORT=invalid\n");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("STACK_ENV_PORT");
});

test("a trusted frozen blob cannot bypass client schema checks during builds", async () => {
  const result = await load("STACK_ENV_TOKEN=\n", "client", {
    _VARLOCK_USE_INJECTED_ENV: "1",
    __VARLOCK_ENV: JSON.stringify({
      frozen: true,
      config: { STACK_ENV_TOKEN: { value: "synthetic", isSensitive: true } },
      settings: {},
      sources: [],
    }),
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Client configuration contains sensitive item STACK_ENV_TOKEN");
});

test("client classification rejects direct runtime functions without executing them", async () => {
  const result = await load(
    "# @public=eq(exec(`printf yes > marker; printf yes`),yes)\nSTACK_ENV_NAME=metadata\n",
    "client",
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("classification must be literal");
  expect(result.stderr).not.toContain("command failed");
  expect(existsSync(join(result.cwd, "marker"))).toBe(false);
});

test("backend builds skip conditional required checks on dynamic credentials", async () => {
  const result = await load(
    "# @public\nSTACK_ENV_MODE=production\n# @required=eq($STACK_ENV_MODE,production)\nSTACK_ENV_TOKEN=exec(`exit 97`)\n",
  );
  expect(result.status, result.stderr).toBe(0);
});

test.each([
  { mode: "development", status: 0 },
  { mode: "production", status: 1 },
])("runtime validation retains conditional requirements in $mode", async ({ mode, status }) => {
  const result = await load(
    `# @public\nSTACK_ENV_MODE=${mode}\n# @required=eq($STACK_ENV_MODE,production)\nSTACK_ENV_TOKEN=\n`,
    "runtime",
  );
  expect(result.status, result.stderr).toBe(status);
});
