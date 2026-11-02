export interface ReleaseRequest {
  channel: "nightly" | "latest";
  stableVersion: string;
  publishedVersions: string[];
  date: string;
  runNumber: string;
  nightlyTag?: string;
  versionOverride?: string;
}

export const normalVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const nightlyVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.(\d{8})\.([1-9]\d*)$/;

export function latestNightly(
  history: readonly {
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    published_at: string | null;
  }[],
) {
  const nightly = history
    .filter(
      (release) =>
        !release.draft &&
        release.prerelease &&
        release.published_at &&
        release.tag_name.startsWith("v") &&
        nightlyVersion.test(release.tag_name.slice(1)),
    )
    .sort((a, b) => compareRelease(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
  if (!nightly) throw new Error("Publish a successful nightly before releasing latest");
  return nightly;
}

function compareNormal(left: string, right: string) {
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export function assertNewVersion(version: string, publishedVersions: string[]) {
  const target = version.split("-")[0]!;
  if (!normalVersion.test(target)) throw new Error("Invalid normal release version");
  if (
    publishedVersions.some(
      (published) => normalVersion.test(published) && compareNormal(target, published) <= 0,
    )
  )
    throw new Error(
      "This version has already been released or superseded; finish stable release bookkeeping before another nightly",
    );
}

export function planRelease(request: ReleaseRequest) {
  if (!normalVersion.test(request.stableVersion)) throw new Error("Invalid last stable version");
  const override = request.versionOverride?.trim();
  let version: string;
  if (request.channel === "nightly") {
    if (override) throw new Error("The stable version override is supported only for latest");
    const [major, minor, patch] = request.stableVersion.split(".");
    const target = `${major}.${minor}.${BigInt(patch!) + 1n}`;
    version = `${target}-nightly.${new Date(request.date).toISOString().slice(0, 10).replaceAll("-", "")}.${request.runNumber}`;
  } else {
    const nightly = request.nightlyTag?.startsWith("v") ? request.nightlyTag.slice(1) : "";
    if (!nightlyVersion.test(nightly))
      throw new Error("Select a successful nightly before releasing latest");
    version = override || nightly.split("-")[0]!;
    if (!normalVersion.test(version))
      throw new Error("Stable version override must be a plain x.y.z version");
  }
  assertNewVersion(version, [...request.publishedVersions, request.stableVersion]);
  return { channel: request.channel, version, tag: `v${version}` };
}

function compareRelease(left: string, right: string) {
  for (const version of [left, right]) {
    if (!normalVersion.test(version) && !nightlyVersion.test(version))
      throw new Error(`Unexpected channel version: ${version}`);
  }
  const [a, aSuffix] = left.split("-");
  const [b, bSuffix] = right.split("-");
  const base = compareNormal(a!, b!);
  if (base !== 0) return base;
  if (!aSuffix || !bSuffix) return aSuffix === bSuffix ? 0 : aSuffix ? -1 : 1;
  const [, aDate, aRun] = aSuffix.split(".");
  const [, bDate, bRun] = bSuffix.split(".");
  for (const [x, y] of [
    [aDate!, bDate!],
    [aRun!, bRun!],
  ]) {
    if (BigInt(x!) < BigInt(y!)) return -1;
    if (BigInt(x!) > BigInt(y!)) return 1;
  }
  return 0;
}

export function publicationAction(artifact: {
  channel: "latest" | "nightly";
  version: string;
  integrity: string;
  publishedIntegrity?: string;
  currentVersion?: string;
  publishedVersions?: string[];
}) {
  if (!(artifact.channel === "latest" ? normalVersion : nightlyVersion).test(artifact.version))
    throw new Error("Version does not match release channel");
  const pattern = artifact.channel === "latest" ? normalVersion : nightlyVersion;
  const newer = [
    artifact.currentVersion,
    ...(artifact.publishedVersions ?? []).filter((version) => pattern.test(version)),
  ].some((version) => version !== undefined && compareRelease(version, artifact.version) > 0);
  if (artifact.publishedIntegrity !== undefined) {
    if (artifact.publishedIntegrity !== artifact.integrity)
      throw new Error("Published integrity differs from tested tarball");
    return {
      publish: false,
      updateDistTag: !newer && artifact.currentVersion !== artifact.version,
      isNewest: !newer,
    };
  }
  if (newer) throw new Error("Publication would regress the channel");
  return { publish: true, updateDistTag: false, isNewest: true };
}
