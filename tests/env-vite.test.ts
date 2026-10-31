import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

test("one browser artifact boots with two runtime configurations through Stack imports", () => {
  const result = spawnSync("bun", ["--no-env-file", resolve("scripts/probe-varlock.ts")], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 35_000);
