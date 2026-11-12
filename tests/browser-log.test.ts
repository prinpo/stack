import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

function run(source: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bun", ["--no-env-file", "--eval", source], {
    env: { ...process.env, NODE_ENV: "development", ...env },
    encoding: "utf8",
  });
}

test("browserLog retains server output without a frontend", () => {
  const result = run(
    `import { browserLog } from "./src/browser-log"; browserLog("hello", { count: 2 });`,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("hello");
  expect(result.stdout).toContain("count");
});

test("the built boundary silences browserLog even in development mode", () => {
  const result = run(
    `import "./src/browser-log/built"; import { browserLog } from "./src/browser-log"; browserLog("must not appear");`,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("");
});

test("native server builds lock browser logging before external module initialization", async () => {
  const root = await mkdtemp(join(process.cwd(), ".stack-test-built-log-"));
  try {
    await writeFile(
      join(root, "dependency.ts"),
      'import { browserLog } from "@prinpo/stack/browser-log"; browserLog("secret-at-module-initialization");',
    );
    await writeFile(
      join(root, "entry.ts"),
      'import "./dependency"; import {browserLog} from "@prinpo/stack/browser-log"; browserLog("secret-at-entry"); console.log("ready");',
    );
    const built = spawnSync(
      "bun",
      [
        "build",
        "--target",
        "bun",
        "--packages",
        "external",
        "--banner",
        'import "@prinpo/stack/browser-log/built";',
        join(root, "entry.ts"),
        "--outfile",
        join(root, "built.js"),
      ],
      { encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);
    const result = spawnSync(
      "bun",
      ["--no-env-file", "--preload", resolve("src/browser-log/preload.ts"), join(root, "built.js")],
      { env: { ...process.env, NODE_ENV: "development" }, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
