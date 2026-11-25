import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { DatabasePolicy } from "../config/schema";

import { readBuildManifest } from "../build-manifest";
import { isFile } from "../files";

export { isFile } from "../files";
export const databaseConfig = "drizzle.config.ts";
export const migrationsDirectory = "migrations";
export const databaseArtifacts = {
  config: "dist/database/drizzle.config.js",
  migrations: "dist/database/migrations",
} as const;

export function migrationCount(directory: string) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return 0;
  return readdirSync(directory, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && isFile(join(directory, entry.name, "migration.sql")),
  ).length;
}

/** Inspect conventional files only; never evaluate application configuration. */
export function inspectDatabase(policy?: DatabasePolicy) {
  const enabled = policy !== "external" && isFile(databaseConfig);
  const count = enabled ? migrationCount(migrationsDirectory) : 0;
  const reason = !enabled
    ? `Missing ${databaseConfig}`
    : count
      ? `${count} local migration${count === 1 ? "" : "s"}`
      : "No migrations found; production build/start requires an initial committed migration. Run stack db generate.";
  return {
    enabled,
    directory: migrationsDirectory,
    count,
    ready: !enabled || count > 0,
    reason:
      policy === "external"
        ? `${databaseConfig} disabled (config override: external)`
        : `${reason}${policy === "managed" ? " (config override: managed)" : ""}`,
  };
}

/** Built capabilities come only from the successful manifest, never source presence. */
export function builtDatabase(manifest = readBuildManifest()) {
  if (manifest.database === false) return false;
  const database = manifest.database;
  if (
    !database ||
    typeof database !== "object" ||
    !("config" in database) ||
    database.config !== databaseArtifacts.config ||
    !("migrations" in database) ||
    database.migrations !== databaseArtifacts.migrations
  )
    throw new Error("Invalid database build manifest. Run stack build.");
  if (!isFile(databaseArtifacts.config) || !migrationCount(databaseArtifacts.migrations))
    throw new Error("Database build artifacts missing or invalid. Run stack build.");
  return databaseArtifacts;
}
