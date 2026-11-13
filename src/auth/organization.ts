import {
  type OrganizationOptions,
  organization as nativeOrganization,
} from "better-auth/plugins/organization";

import { authDelivery } from "./delivery";

export * from "better-auth/plugins/organization";

export function sendInvitationEmail(sender?: OrganizationOptions["sendInvitationEmail"]) {
  return authDelivery("invitation", sender);
}

/** Adds development invitation delivery without changing native organization configuration. */
export const organization = ((options?: OrganizationOptions) => {
  const send = sendInvitationEmail(options?.sendInvitationEmail);
  return {
    ...nativeOrganization({ ...options, sendInvitationEmail: send }),
    stackDelivery: [send],
  };
}) as unknown as typeof nativeOrganization;
