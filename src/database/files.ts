import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
export function inspectDatabase() {
  const enabled = isFile(databaseConfig);
  const count = enabled ? migrationCount(migrationsDirectory) : 0;
  return {
    enabled,
    directory: migrationsDirectory,
    count,
    ready: !enabled || count > 0,
    reason: !enabled
      ? `Missing ${databaseConfig}`
      : count
        ? `${count} local migration${count === 1 ? "" : "s"}`
        : "No migrations found; production build/start requires an initial committed migration. Run stack db generate.",
  };
}

/** Built capabilities come only from the successful manifest, never source presence. */
export function builtDatabase() {
  const manifest: unknown = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("version" in manifest) ||
    manifest.version !== 1
  )
    throw new Error("Invalid build manifest. Run stack build.");
  if (!("database" in manifest) || manifest.database === false) return false;
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
