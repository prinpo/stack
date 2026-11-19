import { betterAuth, createAuthHelpers } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";

import { ENV } from "../../env-gen/server";
import { db } from "../database";
import * as schema from "../database/auth.generated";
import { createAuthOptions } from "./config";
import { mailpitSender } from "./mailpit";

const mailUrl = ENV.EXAMPLE_AUTH_MAIL_URL;

export const auth = betterAuth({
  ...createAuthOptions(
    mailUrl ? { baseURL: ENV.BETTER_AUTH_URL, send: mailpitSender(mailUrl) } : undefined,
  ),
  secret: ENV.BETTER_AUTH_SECRET,
  baseURL: ENV.BETTER_AUTH_URL,
  trustedOrigins: [ENV.BETTER_AUTH_URL],
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
});
export const authHelpers = createAuthHelpers(auth);
