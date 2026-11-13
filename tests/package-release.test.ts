import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "vite-plus/test";

import { preparePackage, validatePackage } from "../scripts/release/package";
import { createTestDirectory } from "./test-utils/directory";

test("a packed Stack release works outside the workspace, including its CLI and browser build", async () => {
  const output = await createTestDirectory("release-test");
  try {
    const tarball = await preparePackage(resolve("."), output, "0.1.0-nightly.20261101.42");
    await validatePackage(tarball, "0.1.0-nightly.20261101.42");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 120_000);
