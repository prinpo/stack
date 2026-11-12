import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Elysia } from "elysia";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createAuthHelpers } from "../src/auth/helpers";
import { organization } from "../src/auth/organization";
import { logger } from "../src/logger/elysia";

afterEach(() => vi.useRealTimers());

function setup() {
  return betterAuth({
    baseURL: "http://localhost",
    secret: "test-secret-at-least-thirty-two-characters",
    emailAndPassword: { enabled: true },
    plugins: [organization()],
  });
}

test("the built-in auth macro rejects anonymous requests without a logger", async () => {
  const helpers = createAuthHelpers(setup());
  const app = new Elysia()
    .use(helpers.elysia())
    .get("/private", ({ user }) => user, { auth: true });
  const response = await app.handle(new Request("http://localhost/private"));
  expect(response.status).toBe(401);
});

test("an enabled request logger supplies the structured auth failure", async () => {
  const helpers = createAuthHelpers(setup());
  const app = new Elysia()
    .use(logger({ persistence: false }))
    .use(helpers.elysia())
    .get("/private", ({ user }) => user, { auth: true });
  const response = await app.handle(new Request("http://localhost/private"));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ status: 401, message: "Authentication required" });
});

test("signed in users retain native inferred session data", async () => {
  const auth = setup();
  const signed = await auth.api.signUpEmail({
    body: { name: "Ada", email: "ada@example.com", password: "correct-horse-battery" },
    asResponse: true,
  });
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const helpers = createAuthHelpers(auth);
  const app = new Elysia()
    .use(helpers.elysia())
    .get("/private", ({ user }) => ({ email: user.email }), { auth: true });
  const response = await app.handle(
    new Request("http://localhost/private", { headers: { cookie } }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ email: "ada@example.com" });
});

test("required helpers refresh outgoing cookies and reuse the request session", async () => {
  const auth = betterAuth({
    baseURL: "http://localhost",
    secret: "test-secret-at-least-thirty-two-characters",
    emailAndPassword: { enabled: true },
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    session: { expiresIn: 3600, updateAge: 0 },
  });
  const signed = await auth.api.signUpEmail({
    body: { name: "Ada", email: "refresh@example.com", password: "correct-horse-battery" },
    asResponse: true,
  });
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 6 * 60 * 1000);
  const helpers = createAuthHelpers(auth);
  const app = new Elysia().get("/refresh", async (context) => {
    const first = await helpers.getSession(context);
    const second = await helpers.getSession(context);
    return { same: first === second, email: (await helpers.getUser(context))?.email };
  });
  const response = await app.handle(
    new Request("http://localhost/refresh", { headers: { cookie } }),
  );
  expect(await response.json()).toEqual({ same: true, email: "refresh@example.com" });
  expect(response.headers.getSetCookie().join(" ")).toContain("session_token=");
});
