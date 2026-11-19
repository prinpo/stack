import { migrateProductionDatabase } from "../database/startup";
import { loadServerEnv } from "../env/server";

// Worker-only builds have no HTTP startup gate to apply the packaged migrations.
await loadServerEnv({ client: false });
await migrateProductionDatabase();
