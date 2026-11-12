import type { BetterAuthOptions } from "better-auth";

import { browserLog } from "../browser-log";
import { developmentLogging, logState } from "../browser-log/state";

const requirement = Symbol.for("prinpo.stack.auth.delivery");
type Sender<Args extends unknown[]> = (...args: Args) => void | Promise<void>;

/** Compose native senders with automatic development output; no delivery side effects on import. */
export function authDelivery<Args extends unknown[]>(flow: string, sender?: Sender<Args>) {
  const callback = async (...args: Args) => {
    if (developmentLogging()) browserLog(`[auth:${flow}]`, args[0]);
    if (sender) await sender(...args);
    else if (!developmentLogging())
      throw new Error(`Auth ${flow} requires an application sender in production.`);
  };
  Object.defineProperty(callback, requirement, { value: { flow, supplied: !!sender } });
  return callback;
}

type PasswordOptions = NonNullable<BetterAuthOptions["emailAndPassword"]>;
type VerificationOptions = NonNullable<BetterAuthOptions["emailVerification"]>;
export const sendVerificationEmail = (sender?: VerificationOptions["sendVerificationEmail"]) =>
  authDelivery("verification", sender);
export const sendResetPassword = (sender?: PasswordOptions["sendResetPassword"]) =>
  authDelivery("password-reset", sender);

/** Explicit startup validation; schema generation only reads options and never calls this. */
export function validateAuthDelivery(options: BetterAuthOptions) {
  if (!logState.built && process.env.NODE_ENV !== "production") return;
  if (
    (options.emailAndPassword?.requireEmailVerification ||
      options.emailVerification?.sendOnSignUp ||
      options.emailVerification?.sendOnSignIn) &&
    !options.emailVerification?.sendVerificationEmail
  )
    throw new Error("Auth email verification requires sendVerificationEmail in production.");
  const callbacks: unknown[] = [
    options.emailVerification?.sendVerificationEmail,
    options.emailAndPassword?.sendResetPassword,
  ];
  for (const plugin of options.plugins ?? []) {
    if ("stackDelivery" in plugin && Array.isArray(plugin.stackDelivery))
      callbacks.push(...plugin.stackDelivery);
  }
  for (const callback of callbacks) {
    if (typeof callback !== "function") continue;
    const data = (callback as unknown as Record<symbol, { flow: string; supplied: boolean }>)[
      requirement
    ];
    if (data && !data.supplied)
      throw new Error(
        `Auth ${data.flow} requires an application sender in production. Supply the native delivery callback; development console delivery is unavailable in built applications.`,
      );
  }
}
