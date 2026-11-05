import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { builtDatabase, databaseConfig, inspectDatabase } from "./files";
import { runKit } from "./kit";

export function hasProductionDatabase() {
  return process.env._STACK_DATABASE_BUILT === "1" ? !!builtDatabase() : inspectDatabase().enabled;
}

/** Startup gate shared by backend and frontend-only production serving. */
export async function migrateProductionDatabase() {
  const built = process.env._STACK_DATABASE_BUILT === "1";
  const database = built ? builtDatabase() : inspectDatabase();
  if (!database || ("enabled" in database && !database.enabled)) return;
  if ("ready" in database && !database.ready) throw new Error(database.reason);
  const config = "config" in database ? resolve(database.config) : resolve(databaseConfig);
  if (!built) {
    const { default: native } = await import(pathToFileURL(config).href);
    if (native.out !== "./migrations" && native.out !== "migrations")
      throw new Error('Database config must use out: "./migrations".');
  }
  console.error("Database: applying committed migrations");
  await runKit(["migrate", "--config", config]);
  console.error("Database: migrations complete");
}
