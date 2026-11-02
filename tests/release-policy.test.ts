import { expect, test } from "vite-plus/test";

import { latestNightly, planRelease } from "../scripts/release/policy";

test("promotion selects the newest completed nightly without choosing drafts or normal releases", () => {
  const release = (tag_name: string, draft = false, prerelease = true) => ({
    tag_name,
    draft,
    prerelease,
    published_at: draft ? null : "2026-11-01T00:00:00Z",
  });
  expect(
    latestNightly([
      release("v0.1.0-nightly.20261101.9"),
      release("v0.1.0-nightly.20261101.10"),
      release("v0.1.0-nightly.20261102.11", true),
      release("v0.2.0", false, false),
    ]).tag_name,
  ).toBe("v0.1.0-nightly.20261101.10");
  expect(() => latestNightly([])).toThrow("successful nightly");
});

test("nightlies target one patch after the last stable version with a UTC date and workflow run", () => {
  expect(
    planRelease({
      channel: "nightly",
      stableVersion: "0.1.0",
      publishedVersions: [],
      date: "2026-11-01T23:59:00Z",
      runNumber: "42",
    }),
  ).toEqual({
    channel: "nightly",
    version: "0.1.1-nightly.20261101.42",
    tag: "v0.1.1-nightly.20261101.42",
  });
});

test("nightlies reject an intended version that has already shipped or fallen behind", () => {
  for (const stableVersion of ["0.0.8", "0.0.9"]) {
    expect(() =>
      planRelease({
        channel: "nightly",
        stableVersion,
        publishedVersions: ["0.1.0", "0.2.0-nightly.20261101.10"],
        date: "2026-11-01",
        runNumber: "42",
      }),
    ).toThrow("already been released");
  }
});

test("a normal release derives its version from the selected nightly instead of its source manifest", () => {
  expect(
    planRelease({
      channel: "latest",
      stableVersion: "0.1.0",
      publishedVersions: ["0.1.0"],
      nightlyTag: "v0.2.0-nightly.20261101.42",
      date: "2026-11-02",
      runNumber: "43",
    }),
  ).toEqual({ channel: "latest", version: "0.2.0", tag: "v0.2.0" });
});

test("latest accepts a newer plain stable override while nightly rejects an override", () => {
  const request = {
    channel: "latest",
    stableVersion: "0.1.0",
    nightlyTag: "v0.1.1-nightly.20261101.42",
    publishedVersions: ["0.1.0"],
    date: "2026-11-02",
    runNumber: "43",
  } as const;
  expect(
    planRelease({
      ...request,
      publishedVersions: [...request.publishedVersions],
      versionOverride: "0.2.0",
    }),
  ).toEqual({ channel: "latest", version: "0.2.0", tag: "v0.2.0" });
  for (const versionOverride of ["0.1.0", "v0.2.0", "0.2.0-beta.1"]) {
    expect(() =>
      planRelease({
        ...request,
        publishedVersions: [...request.publishedVersions],
        versionOverride,
      }),
    ).toThrow();
  }
  expect(() =>
    planRelease({
      ...request,
      publishedVersions: [],
      channel: "nightly",
      versionOverride: "0.2.0",
    }),
  ).toThrow("only for latest");
  expect(() =>
    planRelease({ ...request, publishedVersions: [], versionOverride: "0.0.9" }),
  ).toThrow("already been released");
});

test("a failed stable finalization prevents targeting that already released patch again", () => {
  expect(() =>
    planRelease({
      channel: "nightly",
      stableVersion: "0.1.0",
      publishedVersions: ["0.1.1"],
      date: "2026-11-02",
      runNumber: "43",
    }),
  ).toThrow("finish stable release bookkeeping");
});

test("promotion rejects missing or malformed nightly tags and stable manifests", () => {
  const valid = {
    channel: "latest",
    stableVersion: "0.1.0",
    publishedVersions: ["0.1.0"],
    nightlyTag: "v0.2.0-nightly.20261101.42",
    date: "2026-11-02",
    runNumber: "43",
  } as const;
  for (const override of [
    { nightlyTag: "" },
    { nightlyTag: "v0.2.0-beta.1" },
    { stableVersion: "00.2.0" },
  ]) {
    expect(() =>
      planRelease({ ...valid, publishedVersions: [...valid.publishedVersions], ...override }),
    ).toThrow();
  }
});

test("publication retries accept only identical tarballs and never regress a channel", async () => {
  const { publicationAction } = await import("../scripts/release/policy");
  const artifact = { version: "0.2.0", channel: "latest", integrity: "sha512-tested" } as const;
  expect(publicationAction({ ...artifact })).toEqual({
    publish: true,
    updateDistTag: false,
    isNewest: true,
  });
  expect(
    publicationAction({
      ...artifact,
      publishedIntegrity: "sha512-tested",
      currentVersion: "0.1.0",
    }),
  ).toEqual({ publish: false, updateDistTag: true, isNewest: true });
  expect(
    publicationAction({
      ...artifact,
      publishedIntegrity: "sha512-tested",
      currentVersion: "0.3.0",
    }),
  ).toEqual({ publish: false, updateDistTag: false, isNewest: false });
  expect(() => publicationAction({ ...artifact, publishedIntegrity: "sha512-other" })).toThrow(
    "integrity",
  );
  expect(() => publicationAction({ ...artifact, currentVersion: "0.3.0" })).toThrow("regress");
});

test("recovering a missing channel pointer cannot select an older published version", async () => {
  const { publicationAction } = await import("../scripts/release/policy");
  const recovery = {
    channel: "latest",
    version: "0.2.0",
    integrity: "sha512-tested",
    publishedIntegrity: "sha512-tested",
    publishedVersions: ["0.2.0", "0.3.0"],
  } as const;
  expect(
    publicationAction({ ...recovery, publishedVersions: [...recovery.publishedVersions] }),
  ).toEqual({ publish: false, updateDistTag: false, isNewest: false });
});
