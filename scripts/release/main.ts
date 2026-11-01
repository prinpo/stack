import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { type GitHubRelease, github, registryPackage, releases } from "./github";
import { command, preparePackage, validatePackage } from "./package";
import {
  assertReleaseVersion,
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
  let source = process.env.GITHUB_SHA!;
  const nightlyTag = process.env.NIGHTLY_TAG ?? "";
  if (channel === "latest") {
    if (!nightlyTag.startsWith("v") || !nightlyVersion.test(nightlyTag.slice(1)))
      throw new Error("Select a published nightly Git tag");
    const nightly = await github<GitHubRelease>(`releases/tags/${nightlyTag}`);
    if (nightly.draft || !nightly.prerelease || !nightly.published_at)
      throw new Error("Selected nightly has not been published");
    source = command(["git", "rev-parse", `${nightlyTag}^{commit}`], sourceDir);
  }
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error("Invalid release source commit");
  command(["git", "merge-base", "--is-ancestor", source, "origin/main"], sourceDir);
  const manifest = JSON.parse(command(["git", "show", `${source}:package.json`], sourceDir));
  const registry = await registryPackage();
  const plan = planRelease({
    channel,
    baseVersion: manifest.version,
    publishedVersions: Object.keys(registry.versions),
    date: run.created_at,
    runNumber: process.env.GITHUB_RUN_NUMBER!,
    nightlyTag,
    version: process.env.NORMAL_VERSION,
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

async function restoreRelease() {
  const release: Release = await Bun.file(metadataPath).json();
  if (release.runId !== process.env.PREPARED_RUN_ID)
    throw new Error("Artifact belongs to another run");
  const run = await github<{ path: string; event: string; head_branch: string }>(
    `actions/runs/${release.runId}`,
  );
  if (
    run.path !== ".github/workflows/release.yml" ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main"
  )
    throw new Error("Only artifacts prepared by the release workflow on main can be resumed");
  if (!/^[a-f0-9]{40}$/.test(release.source)) throw new Error("Invalid prepared source");
  command(["git", "merge-base", "--is-ancestor", release.source, "origin/main"], sourceDir);
  await appendFile(
    process.env.GITHUB_OUTPUT!,
    `source=${release.source}\nversion=${release.version}\n`,
  );
}

async function publishRelease() {
  const release: Release = await Bun.file(metadataPath).json();
  if (
    release.runId !== (process.env.PREPARED_RUN_ID || process.env.GITHUB_RUN_ID) ||
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
  let registry = await registryPackage();
  const action = publicationAction({
    ...release,
    integrity,
    publishedIntegrity: registry.versions[release.version]?.dist.integrity,
    currentVersion: registry["dist-tags"][release.channel],
    publishedVersions: Object.keys(registry.versions),
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
    assertReleaseVersion({
      channel: release.channel,
      baseVersion: release.version.split("-")[0]!,
      publishedVersions: Object.keys(registry.versions),
      nightlyTag: release.nightlyTag,
      version: release.version,
    });
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
  registry = await registryPackage();
  if (registry.versions[release.version]?.dist.integrity !== integrity)
    throw new Error("npm has not exposed the expected artifact yet; rerun the failed publish job");

  if (!existingTag)
    await github("git/refs", "POST", { ref: `refs/tags/${release.tag}`, sha: release.source });
  const history = await releases();
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
    make_latest:
      release.channel === "latest" &&
      registry["dist-tags"].latest === release.version &&
      action.isNewest
        ? "true"
        : "false",
  });
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY!,
    `Published [${release.tag}](${published.html_url}) from ${release.source}.\n`,
  );
}

switch (process.argv[2]) {
  case "resolve":
    await resolveRelease();
    break;
  case "pack":
    await packRelease();
    break;
  case "restore":
    await restoreRelease();
    break;
  case "validate": {
    const release: Release = await Bun.file(metadataPath).json();
    await validatePackage(join(outputDir, `prinpo-stack-${release.version}.tgz`), release.version);
    break;
  }
  case "publish":
    await publishRelease();
    break;
  default:
    throw new Error("Expected resolve, pack or publish");
}
