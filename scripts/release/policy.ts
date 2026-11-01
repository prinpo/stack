export interface ReleaseRequest {
  channel: "nightly" | "latest";
  baseVersion: string;
  publishedVersions: string[];
  date: string;
  runNumber: string;
  nightlyTag?: string;
  version?: string;
}

export const normalVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const nightlyVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.(\d{8})\.([1-9]\d*)$/;

function compareNormal(left: string, right: string) {
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export function assertReleaseVersion(request: Omit<ReleaseRequest, "date" | "runNumber">) {
  if (!normalVersion.test(request.baseVersion)) throw new Error("Invalid intended normal version");
  if (request.channel === "latest") {
    const nightly = request.nightlyTag?.startsWith("v") ? request.nightlyTag.slice(1) : "";
    if (
      !nightlyVersion.test(nightly) ||
      nightly.split("-")[0] !== request.baseVersion ||
      request.version !== request.baseVersion
    )
      throw new Error("Select a nightly and matching normal version");
  }
  if (
    request.publishedVersions.some(
      (version) => normalVersion.test(version) && compareNormal(request.baseVersion, version) <= 0,
    )
  )
    throw new Error("Advance the intended version through a PR before releasing");
}

export function planRelease(request: ReleaseRequest) {
  assertReleaseVersion(request);
  const version =
    request.channel === "latest"
      ? request.version!
      : `${request.baseVersion}-nightly.${new Date(request.date).toISOString().slice(0, 10).replaceAll("-", "")}.${request.runNumber}`;
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
