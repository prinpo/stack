import { drizzle } from "@prinpo/stack/database/bun-sql/sqlite";
import { SQL } from "bun";

import { authRelations } from "../../db/auth.generated";
import { ENV } from "../../env-gen/server";
import { relations } from "./relations";

// The application owns this client, including closing it when the server stops.
export const client = new SQL(ENV.DATABASE_URL);
export const db = drizzle({ client, relations: { ...relations, ...authRelations } });
