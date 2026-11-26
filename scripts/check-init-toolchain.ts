import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { devDependencies, devEngines } from "../package.json";
import review from "../src/cli/init/editors/review.json";
import toolchain from "../src/cli/init/toolchain.json";

// Detect changes by reading Vite+'s private generator as text.
for (const [name, version] of Object.entries(toolchain)) {
  const expected =
    name === "bun"
      ? devEngines.packageManager.version
      : devDependencies[name as keyof typeof devDependencies];
  if (version !== expected)
    throw new Error(
      `Initializer pin ${name}@${version} differs from the root toolchain (${expected}). Update src/cli/init/toolchain.json.`,
    );
}
const distribution = new URL("../node_modules/vite-plus/dist/", import.meta.url);
let generator: string | undefined;
for (const name of await readdir(distribution)) {
  if (!name.endsWith(".js")) continue;
  const source = await readFile(new URL(name, distribution), "utf8");
  const region = source.match(
    /^\/\/ src\/utils\/editor\.ts\n([\s\S]*?)(?=^(?:\/\/ (?:src\/|\.\.\/)|export \{))/m,
  )?.[1];
  if (region) {
    generator = region;
    break;
  }
}
if (!generator)
  throw new Error(
    "Vite+ editor generator location changed. Review upstream editor generation before updating the review baseline.",
  );
const checksum = createHash("sha256").update(generator).digest("hex");
if (review.vitePlus !== toolchain["vite-plus"] || review.generatorSha256 !== checksum) {
  throw new Error(
    `Vite+ editor settings require review. Inspect ${fileURLToPath(distribution)}, update Stack-owned editor files if needed, then record vitePlus=${toolchain["vite-plus"]} and generatorSha256=${checksum} in src/cli/init/editors/review.json. See docs/research/project-initializer-editors-and-prompts.md.`,
  );
}
console.log(`Initializer toolchain and editor review match Vite+ ${review.vitePlus}.`);
