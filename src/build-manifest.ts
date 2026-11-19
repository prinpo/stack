import { readFileSync } from "node:fs";

export const buildManifestVersion = 2;
export const buildManifestPath = "dist/manifest.json";

export function readBuildManifest() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
  } catch {
    throw new Error("Missing or invalid dist/manifest.json. Run stack build before starting.");
  }
  if (
    manifest?.version !== buildManifestVersion ||
    typeof manifest.frontend !== "boolean" ||
    typeof manifest.backend !== "boolean" ||
    typeof manifest.worker !== "boolean" ||
    !(manifest.frontend || manifest.backend || manifest.worker)
  )
    throw new Error("Invalid build manifest. Run stack build before starting.");
  return {
    frontend: manifest.frontend as boolean,
    backend: manifest.backend as boolean,
    worker: manifest.worker as boolean,
    database: manifest.database as unknown,
  };
}
