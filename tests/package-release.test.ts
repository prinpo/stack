import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { command, preparePackage, validatePackage } from "../scripts/release/package";
import { createTestDirectory } from "./test-utils/directory";

test("a packed Stack release works outside the workspace, including its CLI and browser build", async () => {
  const output = await createTestDirectory("release-test");
  try {
    const tarball = await preparePackage(resolve("."), output, "0.1.0-nightly.20261101.42");
    const files = command(["tar", "-tzf", tarball], output).split("\n");
    expect(files).toContain("package/docs/consumer/README.md");
    expect(files).toContain("package/docs/consumer/capabilities.md");
    expect(files).not.toContain("package/docs/README.md");
    expect(command(["tar", "-xOf", tarball, "package/README.md"], output)).toMatch(
      /^# @prinpo\/stack\n/,
    );
    expect(
      files.some((file) => /^package\/docs\/(?:agents|adr|milestones|research)\//.test(file)),
    ).toBe(false);
    expect(files).not.toContain("package/docs/releases.md");
    expect(files).not.toContain("package/docs/self-hosted-runner.md");
    await validatePackage(tarball, "0.1.0-nightly.20261101.42");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 120_000);
