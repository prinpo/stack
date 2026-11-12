import { betterAuth, createAuthHelpers } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";

import { authOptions } from "../auth";
import * as schema from "../db/auth.generated";
import { ENV } from "../env-gen/server";
import { db } from "./database";

export const auth = betterAuth({
  ...authOptions,
  secret: ENV.BETTER_AUTH_SECRET,
  baseURL: ENV.BETTER_AUTH_URL,
  trustedOrigins: [ENV.BETTER_AUTH_URL],
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
});
export const authHelpers = createAuthHelpers(auth);
