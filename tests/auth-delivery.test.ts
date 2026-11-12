import { betterAuth } from "better-auth";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { emailOTP, magicLink } from "../src/auth/plugins";

afterEach(() => vi.restoreAllMocks());

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
  expect(JSON.stringify(output.mock.calls)).toContain(messages[0]);
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
  expect(() => createAuthHelpers(auth).elysia()).toThrow("requires an application sender");
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
  expect(() => createAuthHelpers(auth).elysia()).not.toThrow();
  await auth.api.sendVerificationOTP({
    body: { email: "production@example.com", type: "sign-in" },
  });
  expect(delivered).toHaveLength(1);
  expect(output).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
