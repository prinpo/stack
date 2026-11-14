import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

async function project() {
  const cwd = await createTestDirectory("init");
  directories.push(cwd);
  return cwd;
}

function run(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bun", ["--no-env-file", resolve("src/cli/main.ts"), "init", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1", ...env },
    timeout: 20_000,
  });
}

test("init rejects invalid project names before writing files", async () => {
  const cwd = await project();
  const result = run(cwd, ["../outside"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("unscoped npm package name");
  expect(await readdir(cwd)).toEqual([]);
});

test("init rejects dangling destination symlinks", async () => {
  const cwd = await project();
  await symlink("missing", resolve(cwd, "my-app"));
  const result = run(cwd, ["my-app"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Destination already exists");
  expect(await readdir(cwd)).toEqual(["my-app"]);
});

test("failed installs retain the empty project with actionable recovery instructions", async () => {
  const cwd = await project();
  const result = run(cwd, ["my-app", "--no-editor"], {
    BUN_CONFIG_REGISTRY: "http://127.0.0.1:1",
    BUN_INSTALL_CACHE_DIR: resolve(cwd, "cache"),
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Project retained");
  expect(result.stderr).toContain("bun install");
  expect(result.stderr).toContain("bun run fmt");
  expect(await readFile(resolve(cwd, "my-app/AGENTS.md"), "utf8")).toContain(
    "docs/consumer/README.md",
  );
  const files = await readdir(resolve(cwd, "my-app"));
  expect(files).toContain(".git");
  expect(files).not.toContain("src");
  expect(files).not.toContain(".zed");
});

test.each([
  [[], "project name is required"],
  [["my-app", "--editor", "vim"], "Unknown editor"],
  [["my-app", "--editor", "zed", "--no-editor"], "cannot be combined"],
  [["my-app", "--wat"], "Unknown option"],
  [["my-app", "second"], "one project name"],
])("init validates unattended arguments %j before creating files", async (args, message) => {
  const cwd = await project();
  const result = run(cwd, args);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(await readdir(cwd)).toEqual([]);
});

test("init rejects an existing empty directory and explains editor flags in help", async () => {
  const cwd = await project();
  await mkdir(resolve(cwd, "my-app"));
  const result = run(cwd, ["my-app"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Destination already exists");
  const help = run(cwd, ["--help"]);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("--editor");
  expect(help.stdout).toContain("--no-editor");
});
