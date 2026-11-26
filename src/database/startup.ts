import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readStackConfig } from "../config/load";
import { builtDatabase, databaseConfig, inspectDatabase } from "./files";
import { runKit } from "./kit";

async function productionDatabase(built: boolean) {
  if (built) return builtDatabase();
  const { config } = await readStackConfig();
  const database = inspectDatabase(config.database);
  return database.enabled ? database : false;
}

export async function hasProductionDatabase() {
  return !!(await productionDatabase(process.env._STACK_DATABASE_BUILT === "1"));
}

/** Startup gate shared by backend and frontend-only production serving. */
export async function migrateProductionDatabase() {
  const built = process.env._STACK_DATABASE_BUILT === "1";
  const database = await productionDatabase(built);
  if (!database) return;
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
