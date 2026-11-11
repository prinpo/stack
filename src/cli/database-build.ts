import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { databaseArtifacts, databaseConfig, inspectDatabase } from "../database/files";
import { serverEnvPaths } from "../env/paths";
import { loadStaticEnv } from "../env/server";
import { runBun } from "./tools";

/** Compile executable config without evaluating it; retain complete native migration history. */
export async function buildDatabase(env: NodeJS.ProcessEnv) {
  const database = inspectDatabase();
  if (!database.enabled) return false;
  if (!database.ready) throw new Error(database.reason);
  await loadStaticEnv(serverEnvPaths(), { values: env, profile: env.APP_ENV });
  await mkdir("dist/database", { recursive: true });
  const entry = "dist/database/.entry.ts";
  await writeFile(
    entry,
    `import config from ${JSON.stringify(resolve(databaseConfig))};
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
if (config.out !== "./migrations" && config.out !== "migrations") throw new Error('Database config must use out: "./migrations".');
export default { ...config, out: resolve(dirname(fileURLToPath(import.meta.url)), "migrations") };
`,
  );
  try {
    await runBun(
      [
        "build",
        "--target",
        "bun",
        "--packages",
        "external",
        entry,
        "--outfile",
        databaseArtifacts.config,
      ],
      env,
    );
    await cp(database.directory, databaseArtifacts.migrations, { recursive: true });
  } finally {
    await rm(entry, { force: true });
  }
  return databaseArtifacts;
}
