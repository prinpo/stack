import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

async function repository(stableVersion = "0.1.0") {
  const directory = await createTestDirectory("release-finalize");
  const remote = join(directory, "origin.git");
  const checkout = join(directory, "checkout");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: checkout, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  await mkdir(checkout);
  git("init", "--bare", "--initial-branch=main", remote);
  git("-C", remote, "config", "receive.denyNonFastforwards", "true");
  git("init", "-b", "main");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "core.hooksPath", join(checkout, ".git/hooks"));
  await writeFile(
    join(checkout, "package.json"),
    JSON.stringify(
      {
        name: "@prinpo/stack",
        version: stableVersion,
        description: "Preserve this field",
        dependencies: { citty: "0.2.2" },
      },
      null,
      2,
    ) + "\n",
  );
  const lock = spawnSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: checkout,
    encoding: "utf8",
  });
  expect(lock.status, lock.stderr).toBe(0);
  git("add", ".");
  git("-c", "commit.gpgsign=false", "commit", "-m", "test: seed repository");
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "main");
  const tools = join(checkout, "node_modules/.bin");
  await mkdir(tools, { recursive: true });
  await writeFile(
    join(tools, "vp"),
    `#!/usr/bin/env bun
await Bun.write(process.env.CHECK_MARKER, "checked\\n");
process.exit(Number(process.env.CHECK_EXIT ?? "0"));
`,
  );
  await chmod(join(tools, "vp"), 0o755);
  return {
    directory,
    checkout,
    remote,
    git,
    finalize(version: string, overrides: NodeJS.ProcessEnv = {}) {
      return spawnSync("bun", ["--no-env-file", resolve("scripts/release/finalize.ts")], {
        env: {
          ...process.env,
          SOURCE_DIR: checkout,
          RELEASE_VERSION: version,
          CHECK_MARKER: join(directory, "checked"),
          ...overrides,
        },
        encoding: "utf8",
        timeout: 20_000,
      });
    },
    version: () => JSON.parse(git("--git-dir", remote, "show", "main:package.json")).version,
  };
}

test("finalization records the released version on main and rerunning it makes no second commit", async () => {
  const repo = await repository();
  try {
    const result = repo.finalize("0.1.1");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(repo.version()).toBe("0.1.1");
    expect(await readFile(join(repo.directory, "checked"), "utf8")).toBe("checked\n");
    const manifest = JSON.parse(repo.git("--git-dir", repo.remote, "show", "main:package.json"));
    expect(manifest.description).toBe("Preserve this field");
    const head = repo.git("--git-dir", repo.remote, "rev-parse", "main");
    expect(repo.finalize("0.1.1").status).toBe(0);
    expect(repo.git("--git-dir", repo.remote, "rev-parse", "main")).toBe(head);
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
}, 30_000);

test("finalization retries a competing main push and preserves the developer's commit", async () => {
  const repo = await repository();
  try {
    const competitor = join(repo.directory, "competitor");
    repo.git("clone", repo.remote, competitor);
    await writeFile(
      join(repo.checkout, ".git/hooks/pre-push"),
      `#!/bin/sh
set -eu
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
if [ ! -f "$COLLISION_MARKER" ]; then
  touch "$COLLISION_MARKER"
  printf "developer change\\n" > "$COMPETITOR_DIR/unrelated.txt"
  git -C "$COMPETITOR_DIR" add unrelated.txt
  git -C "$COMPETITOR_DIR" -c core.hooksPath=/dev/null -c user.name=Developer -c user.email=fixture@example.invalid -c commit.gpgsign=false commit -m "test: concurrent application change"
  git -C "$COMPETITOR_DIR" -c core.hooksPath=/dev/null push origin HEAD:main
fi
`,
    );
    await chmod(join(repo.checkout, ".git/hooks/pre-push"), 0o755);
    const result = repo.finalize("0.1.1", {
      COMPETITOR_DIR: competitor,
      COLLISION_MARKER: join(repo.directory, "collision"),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(repo.version()).toBe("0.1.1");
    expect(repo.git("--git-dir", repo.remote, "show", "main:unrelated.txt")).toBe(
      "developer change",
    );
    expect(repo.git("--git-dir", repo.remote, "log", "-2", "--format=%s")).toBe(
      "chore(release): record v0.1.1\ntest: concurrent application change",
    );
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
}, 30_000);

test("finalization never downgrades a newer stable version already recorded on main", async () => {
  const repo = await repository("0.2.0");
  try {
    const head = repo.git("--git-dir", repo.remote, "rev-parse", "main");
    const result = repo.finalize("0.1.1");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(repo.version()).toBe("0.2.0");
    expect(repo.git("--git-dir", repo.remote, "rev-parse", "main")).toBe(head);
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
}, 30_000);

test("bookkeeping validation failure leaves origin main untouched", async () => {
  const repo = await repository();
  try {
    const head = repo.git("--git-dir", repo.remote, "rev-parse", "main");
    const result = repo.finalize("0.1.1", { CHECK_EXIT: "1" });
    expect(result.status).not.toBe(0);
    expect(repo.version()).toBe("0.1.0");
    expect(repo.git("--git-dir", repo.remote, "rev-parse", "main")).toBe(head);
  } finally {
    await rm(repo.directory, { recursive: true, force: true });
  }
}, 30_000);
