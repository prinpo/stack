import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testRoot = fileURLToPath(new URL("../../.stack-tests/", import.meta.url));

/** Keep the shared parent in place; callers clean up only their own fixture. */
export async function createTestDirectory(type?: string) {
  await mkdir(testRoot, { recursive: true });
  return mkdtemp(join(testRoot, type ? `.stack-test-${type}-` : ".stack-test-"));
}
