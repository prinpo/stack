import { defineConfig } from "@prinpo/stack/database";

import { ENV } from "./src/env-gen/server";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/server/database/schema.ts", "./src/db/auth.generated.ts"],
  dbCredentials: { url: ENV.DATABASE_URL },
});
