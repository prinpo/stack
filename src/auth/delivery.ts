import type { BetterAuthOptions } from "better-auth";

import { browserLog } from "../browser-log";
import { developmentLogging, logState } from "../browser-log/state";

const requirement = Symbol.for("prinpo.stack.auth.delivery");
type Sender<Args extends unknown[]> = (...args: Args) => void | Promise<void>;

/** Auth links are plain text on their own line so DevTools never includes object quotes. */
function logDelivery(flow: string, data: unknown) {
  if (!data || typeof data !== "object") {
    browserLog(`[auth:${flow}]`, data);
    return;
  }
  const payload = data as Record<string, unknown>;
  const user =
    payload.user && typeof payload.user === "object"
      ? (payload.user as Record<string, unknown>)
      : undefined;
  const email = typeof payload.email === "string" ? payload.email : user?.email;
  const lines = [`[auth:${flow}]`];
  if (typeof email === "string") lines.push(`To: ${email}`);
  if (typeof payload.type === "string") lines.push(`Purpose: ${payload.type}`);
  if (typeof payload.otp === "string") lines.push(`Code: ${payload.otp}`);
  if (typeof payload.url === "string") lines.push("Open this link:", payload.url);
  if (flow === "invitation" && typeof payload.id === "string")
    lines.push(`Invitation ID: ${payload.id}`);
  if (lines.length === 1) browserLog(lines[0], data);
  else browserLog(lines.join("\n"));
}

/** Compose native senders with automatic development output; no delivery side effects on import. */
export function authDelivery<Args extends unknown[]>(flow: string, sender?: Sender<Args>) {
  const callback = async (...args: Args) => {
    if (developmentLogging()) logDelivery(flow, args[0]);
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
