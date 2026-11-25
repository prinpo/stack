import { readFileSync } from "node:fs";
import { z } from "zod";

import { stackConfigSchema } from "./config/schema";

export const buildManifestVersion = 3;
export const buildManifestPath = "dist/manifest.json";

const buildManifestSchema = z
  .strictObject({
    version: z.literal(buildManifestVersion),
    frontend: z.boolean(),
    backend: z.boolean(),
    worker: z.boolean(),
    database: z.unknown().nonoptional(),
    config: stackConfigSchema,
  })
  .refine(({ frontend, backend, worker }) => frontend || backend || worker, "No build capabilities")
  .refine(({ config, database }) => config.database !== "external" || database === false, {
    path: ["database"],
    message: "External database policy cannot advertise managed database artifacts",
  });

export function readBuildManifest() {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
  } catch {
    throw new Error("Missing or invalid dist/manifest.json. Run stack build before starting.");
  }
  const result = buildManifestSchema.safeParse(manifest);
  if (!result.success)
    throw new Error(
      `Invalid build manifest. Run stack build before starting.\n${z.prettifyError(result.error)}`,
    );
  return result.data;
}
