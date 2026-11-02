import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type GitHubRelease, github, releaseState } from "./github";
import { command, preparePackage, validatePackage } from "./package";
import {
  assertNewVersion,
  latestNightly,
  nightlyVersion,
  normalVersion,
  planRelease,
  publicationAction,
} from "./policy";

interface Release {
  channel: "latest" | "nightly";
  version: string;
  tag: string;
  source: string;
  runId: string;
  nightlyTag?: string;
}

const sourceDir = resolve(process.env.SOURCE_DIR ?? ".");
const outputDir = resolve(process.env.ARTIFACT_DIR ?? "dist/release");
const metadataPath = join(outputDir, "release.json");

async function resolveRelease() {
  const channel = process.env.RELEASE_CHANNEL;
  if (channel !== "nightly" && channel !== "latest") throw new Error("Unknown release channel");
  if (process.env.GITHUB_REF !== "refs/heads/main") throw new Error("Dispatch releases from main");
  const runId = process.env.GITHUB_RUN_ID!;
  const run = await github<{ created_at: string }>(`actions/runs/${runId}`);
  const { history, publishedVersions } = await releaseState();
  let source = process.env.GITHUB_SHA!;
  let nightlyTag: string | undefined;
  if (channel === "latest") {
    nightlyTag = latestNightly(history).tag_name;
    source = command(["git", "rev-parse", `${nightlyTag}^{commit}`], sourceDir);
  }
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error("Invalid release source commit");
  command(["git", "merge-base", "--is-ancestor", source, "origin/main"], sourceDir);
  if (
    channel === "latest" &&
    command(
      ["git", "diff", "--name-only", source, "origin/main", "--", ".github/workflows"],
      sourceDir,
    )
  )
    throw new Error(
      "Release workflows changed since the selected nightly. Publish a fresh nightly before releasing latest.",
    );
  const manifest = JSON.parse(command(["git", "show", `${source}:package.json`], sourceDir));
  const plan = planRelease({
    channel,
    stableVersion: manifest.version,
    publishedVersions,
    date: run.created_at,
    runNumber: process.env.GITHUB_RUN_NUMBER!,
    nightlyTag,
    versionOverride: process.env.STABLE_VERSION_OVERRIDE,
  });
  await Bun.write(
    metadataPath,
    JSON.stringify({ ...plan, source, runId, nightlyTag }, null, 2) + "\n",
  );
  await appendFile(process.env.GITHUB_OUTPUT!, `source=${source}\nversion=${plan.version}\n`);
}

async function packRelease() {
  const release: Release = await Bun.file(metadataPath).json();
  const tarball = await preparePackage(sourceDir, outputDir, release.version);
  await validatePackage(tarball, release.version);
}

async function publishRelease() {
  const release: Release = await Bun.file(metadataPath).json();
  if (
    release.runId !== process.env.GITHUB_RUN_ID ||
    !/^[a-f0-9]{40}$/.test(release.source) ||
    release.tag !== `v${release.version}`
  )
    throw new Error("Invalid release metadata or artifact from another run");
  const filename = `prinpo-stack-${release.version}.tgz`;
  if (!(release.channel === "latest" ? normalVersion : nightlyVersion).test(release.version))
    throw new Error("Invalid release version");
  const tarball = join(outputDir, filename);
  const bytes = await readFile(tarball);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if ((await readFile(join(outputDir, "SHA256SUMS"), "utf8")) !== `${checksum}  ${filename}\n`)
    throw new Error("Release tarball checksum mismatch");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const { registry, history, publishedVersions } = await releaseState();
  const action = publicationAction({
    ...release,
    integrity,
    publishedIntegrity: registry.versions[release.version]?.dist.integrity,
    currentVersion: registry["dist-tags"][release.channel],
    publishedVersions,
  });
  // Resolve existing tags before npm publication; never move a tag to repair a conflict.
  const tags = JSON.parse(
    command(
      ["gh", "api", "--paginate", "--slurp", "repos/prinpo/stack/tags?per_page=100"],
      sourceDir,
    ),
  ).flat() as { name: string; commit: { sha: string } }[];
  const existingTag = tags.find((tag) => tag.name === release.tag);
  if (existingTag && existingTag.commit.sha !== release.source)
    throw new Error("Existing Git tag points at a different source");
  if (action.publish) {
    // Recheck version policy in case a prepared release has become stale.
    assertNewVersion(release.version, publishedVersions);
    command(
      [
        "npm",
        "--prefix",
        outputDir,
        "publish",
        tarball,
        "--access",
        "public",
        "--tag",
        release.channel,
        "--provenance",
        "--ignore-scripts",
      ],
      sourceDir,
    );
  } else if (action.updateDistTag) {
    command(
      [
        "npm",
        "--prefix",
        outputDir,
        "dist-tag",
        "add",
        `@prinpo/stack@${release.version}`,
        release.channel,
      ],
      sourceDir,
    );
  }
  if (!existingTag)
    await github("git/refs", "POST", { ref: `refs/tags/${release.tag}`, sha: release.source });
  let published = history.find((entry) => entry.tag_name === release.tag);
  if (!published) {
    const pattern = release.channel === "latest" ? normalVersion : nightlyVersion;
    const previous = history
      .filter(
        (entry) =>
          !entry.draft &&
          entry.published_at &&
          pattern.test(entry.tag_name.slice(1)) &&
          Bun.semver.order(entry.tag_name.slice(1), release.version) < 0,
      )
      .sort((a, b) => Bun.semver.order(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
    // Without an explicit previous tag, GitHub may select one from the other channel.
    const notes = previous
      ? await github<{ body: string }>("releases/generate-notes", "POST", {
          tag_name: release.tag,
          target_commitish: release.source,
          previous_tag_name: previous.tag_name,
        })
      : {
          body: `Initial ${release.channel} release.\n\nSource: https://github.com/prinpo/stack/commit/${release.source}`,
        };
    // Keep the release draft until all recovery assets have been attached.
    published = await github<GitHubRelease>("releases", "POST", {
      tag_name: release.tag,
      target_commitish: release.source,
      name: `Stack ${release.tag}`,
      body: notes.body,
      draft: true,
      prerelease: release.channel === "nightly",
    });
  }
  command(
    [
      "gh",
      "release",
      "upload",
      release.tag,
      tarball,
      join(outputDir, "SHA256SUMS"),
      metadataPath,
      "--repo",
      "prinpo/stack",
      "--clobber",
    ],
    sourceDir,
  );
  await github(`releases/${published.id}`, "PATCH", {
    draft: false,
    make_latest: release.channel === "latest" && action.isNewest ? "true" : "false",
  });
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY!,
    `Published [${release.tag}](${published.html_url}) from ${release.source}.\n\nnpm submission succeeded. Registry availability may be delayed by npm processing. The attached tarball was validated before submission.\n`,
  );
}

switch (process.argv[2]) {
  case "resolve":
    await resolveRelease();
    break;
  case "pack":
    await packRelease();
    break;
  case "publish":
    await publishRelease();
    break;
  default:
    throw new Error("Expected resolve, pack or publish");
}
