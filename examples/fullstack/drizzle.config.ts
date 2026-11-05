import { defineConfig } from "drizzle-kit";

import { ENV } from "./src/env/server";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/database/schema.ts",
  out: "./migrations",
  dbCredentials: { url: ENV.DATABASE_URL },
});
