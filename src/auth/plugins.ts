import { emailOTP as nativeEmailOTP } from "better-auth/plugins/email-otp";
import { magicLink as nativeMagicLink } from "better-auth/plugins/magic-link";

import { authDelivery } from "./delivery";

export * from "better-auth/plugins";
export { organization, sendInvitationEmail } from "./organization";

type OTPOptions = Parameters<typeof nativeEmailOTP>[0];
type MagicOptions = Parameters<typeof nativeMagicLink>[0];

/** Native plugin options with an optional application sender and automatic development logging. */
export function emailOTP(
  options: Omit<OTPOptions, "sendVerificationOTP"> &
    Partial<Pick<OTPOptions, "sendVerificationOTP">> = {},
) {
  const send = authDelivery("email-otp", options.sendVerificationOTP);
  return { ...nativeEmailOTP({ ...options, sendVerificationOTP: send }), stackDelivery: [send] };
}

export function magicLink(
  options: Omit<MagicOptions, "sendMagicLink"> & Partial<Pick<MagicOptions, "sendMagicLink">> = {},
) {
  const send = authDelivery("magic-link", options.sendMagicLink);
  return { ...nativeMagicLink({ ...options, sendMagicLink: send }), stackDelivery: [send] };
}
