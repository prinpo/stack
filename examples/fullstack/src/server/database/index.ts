import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql/sqlite";

import { ENV } from "../../env/server";

// The application owns this client, including closing it when the server stops.
export const client = new SQL(ENV.DATABASE_URL);
export const db = drizzle({ client });
