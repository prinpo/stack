import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

test("example profiles load committed defaults and keep personal and production overrides separate", async () => {
  const cwd = await createTestDirectory("env-files");
  try {
    for (const file of [
      "client/.env",
      "client/.env.schema",
      "client/.env.development",
      "client/.env.production",
      "server/.env",
      "server/.env.schema",
      "server/.env.development",
      "server/.env.production",
    ]) {
      const destination = join(cwd, "env", file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve("examples/fullstack/env", file), destination);
    }
    const schemaPath = join(cwd, "env/server/.env.schema");
    await writeFile(
      schemaPath,
      (await readFile(schemaPath, "utf8")) + "\n# @optional @type=string\nSTACK_ENV_FILE_SECRET=\n",
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VARLOCK_TELEMETRY_DISABLED: "1",
      BETTER_AUTH_SECRET: "synthetic-test-secret-at-least-thirty-two-characters",
      BETTER_AUTH_URL: "http://localhost:5173",
    };
    for (const key of Object.keys(env)) {
      if (
        ["NODE_ENV", "APP_ENV", "PORT", "LOG_DIR", "CLIENT_PUBLIC_DYNAMIC"].includes(key) ||
        key.startsWith("_VARLOCK") ||
        key.startsWith("__VARLOCK") ||
        key.startsWith("STACK_ENV_")
      )
        delete env[key];
    }
    function load(path: string, mode = "development") {
      const result = spawnSync(
        "bun",
        [
          "--no-env-file",
          "--eval",
          `import { loadServerEnv } from "@prinpo/stack/env/server";
const config = await loadServerEnv({ server: ${JSON.stringify(path)} });
const { ENV } = await import("@prinpo/stack/env");
const { environmentRoutes } = await import(${JSON.stringify(resolve("examples/fullstack/src/server/routes/environment.ts"))});
const { Elysia } = await import("@prinpo/stack/server");
const app = new Elysia().use(environmentRoutes);
await app.modules;
const response = await app.handle(new Request("http://localhost/api/env"));
const sandbox = await response.json();
const { readClientEnv } = await import("@prinpo/stack/env/server");
const browser = config.mode === "production" ? config.clientValues : (await readClientEnv({ profile: config.mode })).clientValues;
console.log("STACK_ENV_RESULT=" + JSON.stringify({ mode: config.mode, host: config.host, port: config.port, name: browser.CLIENT_PUBLIC_DYNAMIC, secret: ENV.STACK_ENV_FILE_SECRET, sandbox, browser, cache: response.headers.get("cache-control") }));`,
        ],
        { cwd, env: { ...env, NODE_ENV: mode, APP_ENV: mode }, encoding: "utf8", timeout: 15_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain("WARNING");
      const output = result.stdout.split("\n").find((line) => line.startsWith("STACK_ENV_RESULT="));
      if (!output) throw new Error("Missing env fixture output: " + result.stdout);
      return JSON.parse(output.slice("STACK_ENV_RESULT=".length));
    }
    const development = load("env/server");
    expect(development).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      mode: "development",
      name: "client-public-dynamic-development",
      cache: "no-store",
    });
    expect(development.browser).toEqual({
      CLIENT_PUBLIC_DYNAMIC: "client-public-dynamic-development",
    });
    expect(development.sandbox).toEqual({
      SERVER_PUBLIC_STATIC: "server-public-static-example-value",
      SERVER_PUBLIC_DYNAMIC: "server-public-dynamic-development",
      SERVER_SECRET_STATIC: "demo-only-server-secret-static-value",
      SERVER_SECRET_DYNAMIC: "demo-only-server-secret-dynamic-development",
    });
    await writeFile(
      join(cwd, "env/server/.env.development.local"),
      "STACK_ENV_FILE_SECRET=synthetic-sandbox-credential\n",
    );
    await writeFile(
      join(cwd, "env/client/.env.development.local"),
      "CLIENT_PUBLIC_DYNAMIC=personal\n",
    );
    const personal = load("env/server");
    expect(personal).toMatchObject({
      mode: "development",
      name: "personal",
      secret: "synthetic-sandbox-credential",
    });

    const production = load("env/server", "production");
    expect(production).toMatchObject({
      mode: "production",
      name: "client-public-dynamic-production",
    });
    expect(production.browser).toEqual({
      CLIENT_PUBLIC_DYNAMIC: "client-public-dynamic-production",
    });
    expect(production.sandbox).toEqual({
      SERVER_PUBLIC_STATIC: "server-public-static-example-value",
      SERVER_PUBLIC_DYNAMIC: "server-public-dynamic-production",
      SERVER_SECRET_STATIC: "demo-only-server-secret-static-value",
      SERVER_SECRET_DYNAMIC: "demo-only-server-secret-dynamic-production",
    });
    expect(production).not.toHaveProperty("secret");
    await writeFile(
      join(cwd, "env/server/.env.production.local"),
      "STACK_ENV_FILE_SECRET=synthetic-production-credential\n",
    );
    await writeFile(
      join(cwd, "env/client/.env.production.local"),
      "CLIENT_PUBLIC_DYNAMIC=hosted\n",
    );
    const hosted = load("env/server", "production");
    expect(hosted).toMatchObject({
      mode: "production",
      name: "hosted",
      secret: "synthetic-production-credential",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
