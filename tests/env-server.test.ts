import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

async function server(source: string, credential: string | undefined = "synthetic-secret") {
  const cwd = await createTestDirectory("env-server");
  try {
    await mkdir(join(cwd, "client"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ varlock: { loadPath: "./client" } }),
    );
    await writeFile(
      join(cwd, "client/.env.schema"),
      "# @redact=false @preventLeaks=false\n# ---\n# @public @dynamic\nSTACK_ENV_ORIGIN=\n",
    );
    await writeFile(
      join(cwd, ".env.schema"),
      "# @defaultSensitive=true\n# @redact=false @preventLeaks=false\n# ---\n" +
        "# @public @dynamic @required\nSTACK_ENV_ORIGIN=\n" +
        "# @public @dynamic\nSTACK_ENV_BACKEND_FLAG=backend-only\n" +
        "# @required\nSTACK_ENV_TOKEN=\n",
    );
    await writeFile(
      join(cwd, "server.ts"),
      'const originalConsole = console.log; const OriginalResponse = Response;\nconst { loadServerEnv } = await import("@prinpo/stack/env/server"); await loadServerEnv({ server: ".", client: false });\n' +
        source,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "1" };
    for (const key of Object.keys(env)) {
      if (key.startsWith("STACK_ENV_") || key.startsWith("_VARLOCK") || key.startsWith("__VARLOCK"))
        delete env[key];
    }
    env.STACK_ENV_ORIGIN = "https://deployment.example";
    if (credential) env.STACK_ENV_TOKEN = credential;
    return spawnSync(
      "bun",
      [
        "--no-env-file",
        resolve("node_modules/varlock/bin/cli.js"),
        "run",
        "--path",
        ".",
        "--",
        "bun",
        "--no-env-file",
        "server.ts",
      ],
      {
        cwd,
        env,
        encoding: "utf8",
        timeout: 15_000,
      },
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("missing runtime credentials prevent application initialization", async () => {
  const missing = await server('console.log("APPLICATION_STARTED");', "");
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain("STACK_ENV_TOKEN");
  expect(missing.stdout).not.toContain("APPLICATION_STARTED");
});

test("server initialization retains the CLI graph despite a different client loadPath", async () => {
  const result = await server(
    'import { ENV } from "@prinpo/stack/env";\nconsole.log(JSON.stringify({ token: ENV.STACK_ENV_TOKEN }));',
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null")).toEqual({
    token: "synthetic-secret",
  });
});

test("the default schema leaves console and Response unintercepted", async () => {
  const result = await server(
    "console.log(JSON.stringify({ consoleSame: console.log === originalConsole, responseSame: Response === OriginalResponse }));",
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null")).toEqual({
    consoleSame: true,
    responseSame: true,
  });
});
