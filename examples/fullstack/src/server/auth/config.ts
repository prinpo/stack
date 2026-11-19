import type { BetterAuthOptions } from "@prinpo/stack/auth";

import { sendResetPassword, sendVerificationEmail } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";
import { emailOTP, lastLoginMethod, magicLink } from "@prinpo/stack/auth/plugins";
import { organization } from "@prinpo/stack/auth/plugins/organization";

type AuthDelivery = {
  baseURL: string;
  send(to: string, subject: string, text: string): Promise<void>;
};

export function createAuthOptions(delivery?: AuthDelivery) {
  return {
    database: drizzleAdapter({}, { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: sendResetPassword(
        delivery && (({ user, url }) => delivery.send(user.email, "Reset your password", url)),
      ),
    },
    emailVerification: {
      sendVerificationEmail: sendVerificationEmail(
        delivery && (({ user, url }) => delivery.send(user.email, "Verify your email", url)),
      ),
    },
    plugins: [
      emailOTP({
        sendVerificationOTP:
          delivery && (({ email, otp }) => delivery.send(email, "Your verification code", otp)),
      }),
      magicLink({
        sendMagicLink: delivery && (({ email, url }) => delivery.send(email, "Sign in", url)),
      }),
      organization({
        sendInvitationEmail:
          delivery &&
          (({ email, id }) => {
            const url = new URL("/invitation", delivery.baseURL);
            url.searchParams.set("id", id);
            return delivery.send(email, "Organization invitation", url.href);
          }),
      }),
      lastLoginMethod(),
    ],
  } satisfies BetterAuthOptions;
}

// Offline schema generation uses the same options without runtime credentials.
export const authOptions = createAuthOptions();
