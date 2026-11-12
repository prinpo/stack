import {
  emailOTPClient,
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "@prinpo/stack/auth/client/plugins";
import { createAuthClient } from "@prinpo/stack/auth/react";

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), magicLinkClient(), organizationClient(), lastLoginMethodClient()],
});
