import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import type { GitHubRelease } from "../scripts/release/github";

async function publication(
  options: { channel?: "latest" | "nightly"; npmExit?: number; history?: GitHubRelease[] } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "stack-npm-publication-"));
  try {
    const channel = options.channel ?? "nightly";
    const version = channel === "latest" ? "0.1.0" : "0.1.0-nightly.20261101.42";
    const filename = `prinpo-stack-${version}.tgz`;
    const tarball = Buffer.from("the previously validated release tarball");
    await writeFile(join(directory, filename), tarball);
    await writeFile(
      join(directory, "SHA256SUMS"),
      `${createHash("sha256").update(tarball).digest("hex")}  ${filename}\n`,
    );
    await writeFile(
      join(directory, "release.json"),
      JSON.stringify({
        channel,
        version,
        tag: `v${version}`,
        source: "a".repeat(40),
        runId: "123",
        nightlyTag: "v0.1.0-nightly.20261101.40",
      }),
    );
    await writeFile(
      join(directory, "npm"),
      '#!/bin/sh\nprintf "npm attempted\\n" > "$NPM_CALL"\nexit "$NPM_EXIT"\n',
    );
    await writeFile(
      join(directory, "gh"),
      '#!/bin/sh\nif [ "$1" = "api" ]; then printf "[[]]"; fi\n',
    );
    await chmod(join(directory, "npm"), 0o755);
    await chmod(join(directory, "gh"), 0o755);
    await writeFile(
      join(directory, "registry.ts"),
      `
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith("https://registry.npmjs.org/")) return Response.json({versions: {}, "dist-tags": {}});
  if (url.endsWith("releases?per_page=100&page=1")) return Response.json(${JSON.stringify(options.history ?? [])});
  if (url.endsWith("git/refs") && options.method === "POST") {
    await Bun.write(process.env.GITHUB_REF_WRITE, options.body);
    return Response.json({});
  }
  if (url.endsWith("releases") && options.method === "POST") return Response.json({id: 42, html_url: "https://github.com/prinpo/stack/releases/tag/v${version}"});
  if (url.endsWith("releases/42") && options.method === "PATCH") {
    await Bun.write(process.env.GITHUB_RELEASE_WRITE, options.body);
    return Response.json({});
  }
  throw new Error("Unexpected request: " + url);
};
`,
    );
    const summary = join(directory, "summary.md");
    const result = spawnSync(
      "bun",
      [
        "--no-env-file",
        "--preload",
        join(directory, "registry.ts"),
        resolve("scripts/release/main.ts"),
        "publish",
      ],
      {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GH_TOKEN: "",
          SOURCE_DIR: directory,
          ARTIFACT_DIR: directory,
          PREPARED_RUN_ID: "",
          GITHUB_RUN_ID: "123",
          GITHUB_STEP_SUMMARY: summary,
          NPM_CALL: join(directory, "npm-called"),
          NPM_EXIT: String(options.npmExit ?? 0),
          GITHUB_REF_WRITE: join(directory, "ref-write.json"),
          GITHUB_RELEASE_WRITE: join(directory, "release-write.json"),
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      summary: await readFile(summary, "utf8").catch(() => ""),
      npmCalled: await readFile(join(directory, "npm-called"), "utf8").then(
        () => true,
        () => false,
      ),
      refWritten: await readFile(join(directory, "ref-write.json"), "utf8").then(
        () => true,
        () => false,
      ),
      releaseUpdate: JSON.parse(
        await readFile(join(directory, "release-write.json"), "utf8").catch(() => "null"),
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test.each(["nightly", "latest"] as const)(
  "an accepted %s release completes before npm makes the version visible",
  async (channel) => {
    const result = await publication({ channel });
    expect(result.status, result.output).toBe(0);
    expect(result.npmCalled).toBe(true);
    expect(result.summary).toContain("npm submission succeeded");
    expect(result.releaseUpdate).toEqual({
      draft: false,
      make_latest: channel === "latest" ? "true" : "false",
    });
  },
);

test("npm rejection fails the release without creating GitHub tags or releases", async () => {
  const result = await publication({ npmExit: 1 });
  expect(result.status).not.toBe(0);
  expect(result.npmCalled).toBe(true);
  expect(result.refWritten).toBe(false);
  expect(result.releaseUpdate).toBeNull();
});

test("a normal version recorded on GitHub blocks stale nightlies before npm exposes it", async () => {
  const result = await publication({
    history: [
      {
        id: 7,
        tag_name: "v0.1.0",
        draft: false,
        prerelease: false,
        published_at: "2026-11-01T00:00:00Z",
        html_url: "https://github.com/prinpo/stack/releases/tag/v0.1.0",
        assets: [],
      },
    ],
  });
  expect(result.status).not.toBe(0);
  expect(result.output).toContain("Advance the intended version");
  expect(result.npmCalled).toBe(false);
});
