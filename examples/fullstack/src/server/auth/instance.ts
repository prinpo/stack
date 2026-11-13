import { betterAuth, createAuthHelpers } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";

import { ENV } from "../../env-gen/server";
import { db } from "../database";
import * as schema from "../database/auth.generated";
import { authOptions } from "./config";

export const auth = betterAuth({
  ...authOptions,
  secret: ENV.BETTER_AUTH_SECRET,
  baseURL: ENV.BETTER_AUTH_URL,
  trustedOrigins: [ENV.BETTER_AUTH_URL],
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
});
export const authHelpers = createAuthHelpers(auth);
