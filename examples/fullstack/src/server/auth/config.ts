import type { BetterAuthOptions } from "@prinpo/stack/auth";

import { sendResetPassword, sendVerificationEmail } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";
import { emailOTP, lastLoginMethod, magicLink } from "@prinpo/stack/auth/plugins";
import { organization } from "@prinpo/stack/auth/plugins/organization";

// Native options are also the offline schema source: no database client or runtime credentials.
export const authOptions = {
  database: drizzleAdapter({}, { provider: "sqlite" }),
  emailAndPassword: { enabled: true, sendResetPassword: sendResetPassword() },
  emailVerification: { sendVerificationEmail: sendVerificationEmail() },
  plugins: [emailOTP(), magicLink(), organization(), lastLoginMethod()],
} satisfies BetterAuthOptions;
