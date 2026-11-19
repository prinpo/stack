import { drizzle } from "@prinpo/stack/database/bun-sql/sqlite";
import { SQL } from "bun";

import { ENV } from "../../env-gen/server";
import { authRelations } from "./auth.generated";
import { relations } from "./relations";

export function openDatabase() {
  const client = new SQL(ENV.DATABASE_URL);
  const db = drizzle({ client, relations: { ...relations, ...authRelations } });
  return { client, db };
}
