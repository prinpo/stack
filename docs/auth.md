# Auth Block

Stack owns Better Auth 1.7.21 and its matching relations-v2 Drizzle adapter. Auth is headless: applications enable methods/plugins, own screens and routing, and keep native options, APIs and inference. Nothing is enabled merely by importing the Block. SQLite through Bun SQL is the qualified database combination; other native options remain available without a qualification claim.

## Native configuration and offline schema

The example keeps each auth responsibility in its corresponding runtime area:

| File                                    | Purpose                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/client/auth.ts`                    | Browser Better Auth client, plugins, hooks and actions.                                        |
| `src/server/auth/config.ts`             | Connection-free native options used by schema generation and the running server.               |
| `src/server/auth/instance.ts`           | Running auth instance and bound helpers, using runtime credentials and the app-owned database. |
| `src/server/database/auth.generated.ts` | Generated tables and relations beside the application's handwritten database schema.           |

Keep schema configuration independent from runtime database clients and credentials. The recommended `src/server/auth/config.ts` exports native options:

```ts
import type { BetterAuthOptions } from "@prinpo/stack/auth";

import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";
import { emailOTP, magicLink, lastLoginMethod, organization } from "@prinpo/stack/auth/plugins";

export const authOptions = {
  database: drizzleAdapter({}, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  plugins: [emailOTP(), magicLink(), organization(), lastLoginMethod()],
} satisfies BetterAuthOptions;
```

The adapter above supplies native schema metadata, not a live connection. Runtime code creates `betterAuth({ ...authOptions, secret, baseURL, database: drizzleAdapter(db, { provider: "sqlite", schema }) })` using the app-owned database. The example's [runtime module](../examples/fullstack/src/server/auth/instance.ts) demonstrates this split. Normal runtime code must supply a real Drizzle instance.

```sh
stack auth generate
stack auth check
stack auth info
stack auth secret
stack db generate --name auth
stack db migrate
```

Generation defaults to `src/server/auth/config.ts` and `src/server/database/auth.generated.ts`. It accepts `authOptions`, a native `auth` instance, or a default export of either options or an auth instance. `--config`, `--output`, and `--env` override paths/profile. An existing output requires `--yes` before replacement. The first generation supports an absent output module; config must not eagerly dereference missing generated tables or initialize a runtime database. The static Varlock graph is available without resolving dynamic production credentials, and the auth CLI does not independently load dotenv files.

The native relations-v2 adapter generates tables, relations, indexes and foreign keys. Stack only forwards generated Drizzle import paths through its Database Block. Extend auth tables through native additional fields, regenerate, and generate SQL migrations. Keep application tables/relations outside generated files and exclude generated output from formatting. SQL history, build packaging and production migrations remain Database Block responsibilities. Generation never applies SQL.

`check` compares the configured native schema output against the generated module. It detects missing/stale output; it does not inspect a live database or prove migrations were applied. `info` prints config paths, adapter and plugin IDs as JSON. These explicit operations evaluate configuration; doctor does not. `secret` prints a random 32-byte secret without loading configuration. Help requires neither config nor credentials.

Doctor reports conventional auth config/schema presence and fails when detected configuration lacks its generated module. Use `stack doctor --auth-config path/to/auth.ts --auth-schema path/to/generated.ts` for custom paths. Doctor performs structural inspection only; it cannot detect stale schema or determine sender readiness.

## Delivery

Stack's `magicLink` and `emailOTP` adapters preserve native plugin options and API types while making the sender optional for development. Their dedicated imports are `@prinpo/stack/auth/plugins/magic-link` and `@prinpo/stack/auth/plugins/email-otp`; the aggregate plugins entry exposes the same wrappers. `organization` similarly wraps invitations while preserving native option overloads, including teams/dynamic permissions when an app enables them.

During development, readable delivery messages always appear in the server console and every connected browser, even when a sender such as Mailpit is configured. No extra Vite option is needed. Codes have a labeled line; URLs have their own unquoted line so browser DevTools links remain clickable. Native callback context and options are passed unchanged to app senders. Sender failures retain native Better Auth behavior; console output does not imply successful email transport.

Core native callbacks have small composition helpers:

```ts
import { sendResetPassword, sendVerificationEmail } from "@prinpo/stack/auth";

const emailAndPassword = {
  enabled: true,
  sendResetPassword: sendResetPassword(appSendReset),
};
const emailVerification = {
  sendVerificationEmail: sendVerificationEmail(appSendVerification),
};
```

Omit helper arguments during initial development. Invitation delivery is handled by the wrapped organization plugin; `sendInvitationEmail` is also available from its dedicated entry. Invitation callback data includes its native ID; the app chooses its invitation URL and acceptance route. The example accepts `/invitation?id=<id>` and requires signing in with the invited email.

Builds do not evaluate delivery or require senders. Registering the Elysia integration adds a validation gate that `startServer` awaits after native auth/plugin initialization and before listening in production/built apps. A configured wrapped flow without a sender fails startup with an actionable message. For standalone native hosting, await `helpers.validate()` at the equivalent pre-listen boundary; it checks plugin-composed native options. Direct native plugins/callbacks retain native behavior; Stack can validate only its own delivery helpers. Supplying an app sender does not itself enable an auth method.

## Server helpers

```ts
import { createAuthHelpers } from "@prinpo/stack/auth";
import { Elysia, ElysiaCustomStatusResponse } from "@prinpo/stack/server";

const helpers = createAuthHelpers(auth);
const app = new Elysia()
  .use(helpers.elysia())
  .get("/profile", ({ user, session }) => ({ user, session }), { auth: true });
```

`getSession(context)` and `getUser(context)` are nullable, preserve custom fields, and reuse the native session resolution for a request. Passing Elysia context copies all outgoing refreshed cookies without discarding existing ones. A plain `Request` is also accepted; its caller owns outgoing cookie delivery. The `auth: true` macro returns 401 anonymously and injects typed user/session. Macros are an initial convenience; applications can use the explicit helpers instead.

`requireSession`, `requireOrganization(context, slug)` and `requireMembership(context, slug)` return native Elysia status responses for expected failures. Explicit routes must return those responses when encountered. With the Stack request logger registered first, failures use its `apiError` integration and public serializer; without it they use native `status`. The response contracts remain visible to Eden. Unexpected infrastructure errors propagate normally.

`getOrganizationBySlug` and `getMembership` return null for missing/inaccessible resources. Required variants return 401 anonymously and the same 404 for an absent slug or nonmembership. Membership lookup filters by the current user rather than scanning a limited member page. Native organization authorization remains authoritative. Helpers do not choose an organization's application routing or create organizations automatically. Organization creation, role policy, onboarding, session active organization and URL selection remain app-owned.

## Browser

Use `createAuthClient` from `@prinpo/stack/auth/react` or `/auth/client`, with native plugins from `/auth/client/plugins`. Native session, organization, invitation and last-login hooks/actions stay available. Use `inferAdditionalFields<typeof auth>()` and `inferOrgAdditionalFields<typeof auth>()` with type-only server imports for custom fields; no runtime server import belongs in a browser bundle.

`organizationBySlug(client, slug)` calls the native authorized organization endpoint. React's `useOrganizationBySlug(client, slug)` provides a URL-scoped view that follows native session changes, clears results on logout/account changes, and exposes pending/error state and explicit `refetch`, without selecting an active organization or creating a shared session cache. Native errors remain native client results. Apps decide when to refetch after their own mutations. Last login uses native browser-cookie behavior by default, retaining native database-persistence options.

Social sign-on is native configuration: supply, for example, `socialProviders.google: { clientId, clientSecret }`, configure the provider callback URL, and call `authClient.signIn.social({ provider: "google", callbackURL })`. Any native social provider remains selectable. The runnable example requires no OAuth credentials; add providers through app-owned runtime configuration rather than putting secrets in browser code or schema-generation options.

## Example

Run explicit database preparation once, then development:

```sh
bun run stack db migrate
bun run dev
```

Visit `/auth`, `/organizations`, and `/organizations/<slug>`. Minimal forms cover signup/password login, OTP, magic links, verification/reset, membership and invitations. Sign in to an unverified account to request a verification link; the session view shows verification status. Native verification requests for unknown or already-verified addresses intentionally do not send email. Routes contain routing concerns; feature directories contain views. Production deployment must configure runtime secret/base URL and real delivery callbacks; the teaching example intentionally does not ship an email provider.
