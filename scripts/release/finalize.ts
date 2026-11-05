import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { command } from "./package";
import { normalVersion } from "./policy";

const directory = resolve(process.env.SOURCE_DIR ?? ".");
const version = process.env.RELEASE_VERSION?.trim() ?? "";
if (!normalVersion.test(version)) throw new Error("Finalization requires a plain released version");
if (command(["git", "status", "--porcelain", "--untracked-files=no"], directory))
  throw new Error("Finalization requires a clean checkout");

async function finalize() {
  for (let attempt = 0; attempt < 5; attempt++) {
    command(["git", "fetch", "origin", "main"], directory);
    const base = command(["git", "rev-parse", "origin/main"], directory);
    command(["git", "checkout", "--detach", base], directory);
    const manifestPath = join(directory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!normalVersion.test(manifest.version)) throw new Error("Invalid recorded stable version");
    if (Bun.semver.order(manifest.version, version) >= 0) {
      console.log(`main already records ${manifest.version}; no version update needed`);
      return;
    }
    command(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], directory);
    manifest.version = version;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    command(["bun", "install", "--lockfile-only", "--ignore-scripts"], directory);
    command(["bun", "--bun", "vp", "check"], directory);
    command(["git", "add", "--", "package.json", "bun.lock"], directory);
    command(
      [
        "git",
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        `chore(release): record v${version}`,
      ],
      directory,
    );
    const push = spawnSync("git", ["push", "origin", "HEAD:main"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (push.status === 0) {
      console.log(`Recorded stable version ${version} on main`);
      return;
    }
    command(["git", "fetch", "origin", "main"], directory);
    if (command(["git", "rev-parse", "origin/main"], directory) === base)
      throw new Error(
        `Version bookkeeping push failed: ${push.error ?? push.stdout + push.stderr}`,
      );
    console.log("main advanced; reapplying the version update to its latest commit");
  }
  throw new Error("main kept advancing during finalization; rerun the failed finalization job");
}

await finalize();
