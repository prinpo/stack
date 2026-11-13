import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

test.each([
  { channel: "nightly", workflowChanged: false, versionOverride: "" },
  { channel: "latest", workflowChanged: false, versionOverride: "" },
  { channel: "latest", workflowChanged: true, versionOverride: "" },
  { channel: "latest", workflowChanged: false, versionOverride: "0.2.0" },
] as const)(
  "channel $channel selects source and version (workflows changed: $workflowChanged, override: $versionOverride)",
  async ({ channel, workflowChanged, versionOverride }) => {
    const directory = await createTestDirectory("release-selection");
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    try {
      git("init", "-b", "main");
      git("config", "user.name", "Release fixture");
      git("config", "user.email", "fixture@example.invalid");
      git("config", "tag.gpgSign", "false");
      git("config", "core.hooksPath", "/dev/null");
      await writeFile(join(directory, "package.json"), '{"version":"0.1.0"}\n');
      git("add", "package.json");
      git("-c", "commit.gpgsign=false", "commit", "-m", "fixture: nightly source");
      const nightlySource = git("rev-parse", "HEAD");
      git("tag", "v0.1.1-nightly.20261101.9");
      git("tag", "v0.1.1-nightly.20261101.10");
      await writeFile(join(directory, "application.txt"), "New application changes\n");
      if (workflowChanged) {
        await mkdir(join(directory, ".github/workflows"), { recursive: true });
        await writeFile(
          join(directory, ".github/workflows/release.yml"),
          "name: Updated release\n",
        );
      }
      git("add", ".");
      git("-c", "commit.gpgsign=false", "commit", "-m", "fixture: advance main");
      const mainSource = git("rev-parse", "HEAD");
      git("update-ref", "refs/remotes/origin/main", mainSource);
      await writeFile(
        join(directory, "github.ts"),
        `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.endsWith("actions/runs/123")) return Response.json({created_at: "2026-11-01T12:00:00Z"});
  if (url.startsWith("https://registry.npmjs.org/")) return Response.json({versions: {}, "dist-tags": {}});
  if (url.endsWith("releases?per_page=100&page=1")) return Response.json([9,10].map(run => ({tag_name: "v0.1.1-nightly.20261101." + run, draft: false, prerelease: true, published_at: "2026-11-01T00:00:00Z"})));
  throw new Error("Unexpected request: " + url);
};
`,
      );
      const result = spawnSync(
        "bun",
        [
          "--no-env-file",
          "--preload",
          join(directory, "github.ts"),
          resolve("scripts/release/main.ts"),
          "resolve",
        ],
        {
          env: {
            ...process.env,
            GH_TOKEN: "",
            RELEASE_CHANNEL: channel,
            STABLE_VERSION_OVERRIDE: versionOverride,
            GITHUB_SHA: mainSource,
            GITHUB_REF: "refs/heads/main",
            GITHUB_RUN_ID: "123",
            GITHUB_RUN_NUMBER: "42",
            GITHUB_OUTPUT: join(directory, "actions-output"),
            SOURCE_DIR: directory,
            ARTIFACT_DIR: join(directory, "output"),
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      if (workflowChanged) {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("fresh nightly");
        return;
      }
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const release = JSON.parse(await readFile(join(directory, "output/release.json"), "utf8"));
      expect(release.source).toBe(channel === "latest" ? nightlySource : mainSource);
      expect(release.version).toBe(
        channel === "latest" ? versionOverride || "0.1.1" : "0.1.1-nightly.20261101.42",
      );
      expect(release.nightlyTag).toBe(
        channel === "latest" ? "v0.1.1-nightly.20261101.10" : undefined,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
