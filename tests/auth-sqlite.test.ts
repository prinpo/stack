import { spawnSync } from "node:child_process";
import { expect, test } from "vite-plus/test";

test("SQLite supports signup, sessions, OTP, magic links, and authorized organization slugs", () => {
  const result = spawnSync(
    "bun",
    [
      "--no-env-file",
      "--eval",
      `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SQL } from "bun";
import { drizzle } from "@prinpo/stack/database/bun-sql/sqlite";
import { betterAuth, createAuthHelpers } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";
import { emailOTP, magicLink, lastLoginMethod } from "@prinpo/stack/auth/plugins";
import { organization } from "@prinpo/stack/auth/plugins/organization";
import { Elysia, ElysiaCustomStatusResponse } from "elysia";
import * as schema from "./examples/fullstack/src/server/database/auth.generated";
const client = new SQL("sqlite://:memory:");
try {
  const migration = readFileSync("./examples/fullstack/migrations/20261112082425_auth/migration.sql", "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await client.unsafe(statement);
  const db = drizzle({ client, relations: schema.authRelations });
  let otp = ""; let link = "";
  const auth = betterAuth({ baseURL: "http://localhost", secret: "a-test-secret-at-least-thirty-two-characters", database: drizzleAdapter(db, { provider: "sqlite", schema }), emailAndPassword: { enabled: true }, plugins: [emailOTP({ sendVerificationOTP: async data => { otp = data.otp; } }), magicLink({ sendMagicLink: async data => { link = data.url; } }), organization(), lastLoginMethod()] });
  const signed = await auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "correct-horse-battery" }, asResponse: true });
  assert.equal(signed.status, 200, await signed.clone().text());
  const headers = new Headers({ cookie: signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") });
  const helpers = createAuthHelpers(auth);
  const app = new Elysia().use(helpers.elysia()).get("/private", ({ user }) => user.email, { auth: true });
  assert.equal(await (await app.handle(new Request("http://localhost/private", { headers }))).text(), "ada@example.com");
  await auth.api.createOrganization({ headers, body: { name: "Research", slug: "research" } });
  const org = await helpers.requireOrganization(new Request("http://localhost", { headers }), "research");
  assert.equal(org.name, "Research");
  assert.equal((await helpers.getMembership(new Request("http://localhost", { headers }), "research")).role, "owner");
  const missing = await helpers.requireOrganization(new Request("http://localhost", { headers }), "missing");
  assert.ok(missing instanceof ElysiaCustomStatusResponse); assert.equal(missing.code, 404);
  const outsider = await auth.api.signUpEmail({ body: { name: "Other", email: "other@example.com", password: "correct-horse-battery" }, asResponse: true });
  const otherHeaders = new Headers({ cookie: outsider.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") });
  assert.equal((await helpers.requireOrganization(new Request("http://localhost", { headers: otherHeaders }), "research")).code, 404);
  await auth.api.sendVerificationOTP({ body: { email: "otp@example.com", type: "sign-in" } });
  assert.equal((await auth.api.signInEmailOTP({ body: { email: "otp@example.com", otp } })).user.email, "otp@example.com");
  await auth.api.signInMagicLink({ headers: new Headers(), body: { email: "magic@example.com" } });
  assert.ok(link.includes("/magic-link/verify?"));
  const verified = await auth.handler(new Request(link)); assert.ok(verified.headers.get("set-cookie"));
  console.log("SQLite auth passed");
} finally { await client.close(); }
`,
    ],
    {
      env: { ...process.env, NODE_ENV: "development", BETTER_AUTH_TELEMETRY: "0" },
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("SQLite auth passed");
});
