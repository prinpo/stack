import { betterAuth } from "better-auth";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { emailOTP, magicLink } from "../src/auth/plugins";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("email OTP is logged during development alongside an app sender", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const messages: string[] = [];
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-at-least-thirty-two-characters",
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ otp }) => {
          messages.push(otp);
        },
      }),
    ],
  });
  await auth.api.sendVerificationOTP({ body: { email: "dev@example.com", type: "sign-in" } });
  expect(messages).toHaveLength(1);
  expect(output.mock.calls.flat().join("\n")).toContain(`Code: ${messages[0]}`);
  vi.unstubAllEnvs();
});

test("magic links work without a sender during development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-at-least-thirty-two-characters",
    plugins: [magicLink()],
  });
  await auth.api.signInMagicLink({ headers: new Headers(), body: { email: "dev@example.com" } });
  expect(JSON.stringify(output.mock.calls)).toContain("/magic-link/verify?");
  vi.unstubAllEnvs();
});

test("production integration rejects missing senders without executing them", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { createAuthHelpers } = await import("../src/auth/helpers");
  const auth = betterAuth({
    baseURL: "https://example.com",
    secret: "a-strong-production-test-secret-more-than-32-chars",
    plugins: [magicLink()],
  });
  await expect(createAuthHelpers(auth).validate()).rejects.toThrow(
    "requires an application sender",
  );
  vi.unstubAllEnvs();
});

test("a production sender works without development console output", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const delivered: string[] = [];
  const auth = betterAuth({
    baseURL: "https://example.com",
    secret: "a-strong-production-test-secret-more-than-32-chars",
    plugins: [
      emailOTP({
        sendVerificationOTP: async (data) => {
          delivered.push(data.otp);
        },
      }),
    ],
  });
  const { createAuthHelpers } = await import("../src/auth/helpers");
  await expect(createAuthHelpers(auth).validate()).resolves.toBeUndefined();
  await auth.api.sendVerificationOTP({
    body: { email: "production@example.com", type: "sign-in" },
  });
  expect(delivered).toHaveLength(1);
  expect(output).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});

test("native OTP verification overrides remain valid in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { createAuthHelpers } = await import("../src/auth/helpers");
  const auth = betterAuth({
    baseURL: "https://example.com",
    secret: "a-strong-production-test-secret-more-than-32-chars",
    emailAndPassword: { enabled: true, requireEmailVerification: true },
    plugins: [
      emailOTP({ overrideDefaultEmailVerification: true, sendVerificationOTP: async () => {} }),
    ],
  });
  await expect(createAuthHelpers(auth).validate()).resolves.toBeUndefined();
  vi.unstubAllEnvs();
});

test("example verification sends a link for an existing unverified account", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const { authOptions } = await import("../examples/fullstack/src/server/auth/config");
  const auth = betterAuth({
    ...authOptions,
    database: undefined,
    baseURL: "http://localhost:3000",
    secret: "test-secret-at-least-thirty-two-characters",
  });
  const signed = await auth.api.signUpEmail({
    body: {
      name: "Unverified",
      email: "unverified@example.com",
      password: "correct-horse-battery",
    },
  });
  expect(signed.user.emailVerified).toBe(false);
  output.mockClear();
  await auth.api.sendVerificationEmail({
    body: { email: "unverified@example.com", callbackURL: "/auth" },
  });
  expect(JSON.stringify(output.mock.calls)).toContain("/verify-email?");
  const url = output.mock.calls
    .flat()
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split("\n"))
    .find((line) => line.startsWith("http://localhost:3000/api/auth/verify-email?"));
  expect(url).toBeDefined();
  const verified = await auth.handler(new Request(url!));
  expect(verified.status).toBe(302);
  const signedIn = await auth.api.signInEmail({
    body: { email: "unverified@example.com", password: "correct-horse-battery" },
  });
  expect(signedIn.user.emailVerified).toBe(true);
});

test("development magic links are printed on unquoted lines", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-at-least-thirty-two-characters",
    plugins: [magicLink()],
  });
  await auth.api.signInMagicLink({ headers: new Headers(), body: { email: "dev@example.com" } });
  const lines = output.mock.calls
    .flat()
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split("\n"));
  const url = lines.find((line) =>
    line.startsWith("http://localhost:3000/api/auth/magic-link/verify?"),
  );
  expect(url).toBeDefined();
  expect(url).not.toMatch(/["']$/);
});
