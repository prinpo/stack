---
title: Auth Block
description: Configure headless Better Auth, generate Drizzle schemas, and use Stack session, organization, and delivery helpers.
type: reference
topics:
  - authentication
  - sessions
  - organizations
  - email delivery
  - schema generation
related:
  title: Related
  links:
    - database.md
    - env.md
    - cli.md
    - logger.md
    - application-patterns.md
---

# Auth Block

Use this Block for authentication and organization membership. Stack owns Better Auth 1.7.21 and its matching relations-v2 Drizzle adapter. Applications choose methods/plugins, screens, redirects, role policies, and email transport. Importing auth enables no method automatically. SQLite through Bun SQL is the qualified database combination; other native options remain selectable.

## Public imports

| Import path                               | Surface                                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@prinpo/stack/auth`                      | Native `better-auth`, including `betterAuth` and `BetterAuthOptions`; Stack `createAuthHelpers`, `authDelivery`, `sendResetPassword`, `sendVerificationEmail`, `validateAuthDelivery`. |
| `@prinpo/stack/auth/client`               | Native `better-auth/client` and Stack `organizationBySlug`.                                                                                                                            |
| `@prinpo/stack/auth/react`                | Native `better-auth/react`, plus `organizationBySlug` and `useOrganizationBySlug`.                                                                                                     |
| `@prinpo/stack/auth/client/plugins`       | Native `better-auth/client/plugins`, including inference helpers.                                                                                                                      |
| `@prinpo/stack/auth/plugins`              | Native server plugins, with Stack's `emailOTP`, `magicLink`, and `organization` wrappers and `sendInvitationEmail`.                                                                    |
| `@prinpo/stack/auth/plugins/organization` | Native organization exports, wrapped `organization`, and `sendInvitationEmail`.                                                                                                        |
| `@prinpo/stack/auth/plugins/magic-link`   | Native magic-link exports, with Stack's wrapped `magicLink`.                                                                                                                           |
| `@prinpo/stack/auth/plugins/email-otp`    | Native email-OTP exports, with Stack's wrapped `emailOTP`.                                                                                                                             |
| `@prinpo/stack/auth/adapters/drizzle`     | Native `@better-auth/drizzle-adapter/relations-v2`, including `drizzleAdapter`.                                                                                                        |

Only these declared auth subpaths are public. Use the aggregate plugin entries for other native plugins. Consult the [Better Auth 1.7 documentation index](https://better-auth.com/docs/llms.txt) for native options and plugin APIs; choose documentation matching Stack's installed dependency rather than installing a second Better Auth version.

## Configuration and runtime ownership

Keep generation configuration independent of runtime credentials, generated-table access, and live database connections:

| Recommended file                        | Responsibility                                                           |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `src/server/auth/config.ts`             | Native options used for schema generation and runtime composition.       |
| `src/server/auth/instance.ts`           | Running instance, credentials, real database adapter, and bound helpers. |
| `src/server/database/auth.generated.ts` | Generated tables and `authRelations`.                                    |
| `src/client/auth.ts`                    | Browser client and matching client plugins.                              |

These are recommended module boundaries. For an existing application, preserve equivalent modules and pass custom generation paths through the CLI.

```ts
// src/server/auth/config.ts
import type { BetterAuthOptions } from "@prinpo/stack/auth";

import { sendResetPassword, sendVerificationEmail } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";
import { emailOTP, lastLoginMethod, magicLink } from "@prinpo/stack/auth/plugins";
import { organization } from "@prinpo/stack/auth/plugins/organization";

export const authOptions = {
  database: drizzleAdapter({}, { provider: "sqlite" }),
  emailAndPassword: { enabled: true, sendResetPassword: sendResetPassword() },
  emailVerification: { sendVerificationEmail: sendVerificationEmail() },
  plugins: [emailOTP(), magicLink(), organization(), lastLoginMethod()],
} satisfies BetterAuthOptions;
```

The empty adapter argument is generation metadata only. A running instance requires a real Drizzle database. The sender-free callbacks above support development; supply real delivery callbacks before production startup.

```ts
// src/server/auth/instance.ts
import { betterAuth, createAuthHelpers } from "@prinpo/stack/auth";
import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";

import { ENV } from "../../env-gen/server";
import { db } from "../database";
import * as schema from "../database/auth.generated";
import { authOptions } from "./config";

export const auth = betterAuth({
  ...authOptions,
  secret: ENV.BETTER_AUTH_SECRET,
  baseURL: ENV.BETTER_AUTH_URL,
  trustedOrigins: [ENV.BETTER_AUTH_URL],
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
});
export const authHelpers = createAuthHelpers(auth);
```

Declare `BETTER_AUTH_SECRET` as sensitive, dynamic, and required in the server environment schema. Declare `BETTER_AUTH_URL` as a dynamic required URL. Read credentials through the generated server environment module; see [environment configuration](env.md). Load the runtime instance only after `startServer` initializes the environment. Its default native auth endpoint prefix is `/api/auth`; the Elysia helper mounts the native handler.

## Schema generation and database integration

`stack auth generate` defaults to `src/server/auth/config.ts` and `src/server/database/auth.generated.ts`. It accepts an `authOptions` export, a native `auth` instance, or a default export of either options or an instance. Prefer connection-free options. The generator loads static configuration, uses the native relations-v2 adapter, and rewrites generated Drizzle imports to Stack's database paths. It does not connect to a database, enable auth methods, or apply SQL.

Include generated tables in the root Drizzle config's `schema` list alongside handwritten application tables. When creating the runtime database, combine generated `authRelations` with application relations:

```ts
// src/server/database/index.ts
import { drizzle } from "@prinpo/stack/database/bun-sql/sqlite";
import { SQL } from "bun";

import { ENV } from "../../env-gen/server";
import { authRelations } from "./auth.generated";
import { relations } from "./relations";

export const client = new SQL(ENV.DATABASE_URL);
export const db = drizzle({ client, relations: { ...relations, ...authRelations } });
```

The native generator produces tables, relations, indexes, and foreign keys. Extend models through native additional-field/plugin options, regenerate, then create and apply a SQL migration through the Database Block. Keep handwritten schema and relations outside generated files. Exclude generated modules from formatting. Generation can start with an absent output file, but configuration must tolerate that absence without dereferencing generated tables.

See [CLI auth operations](cli.md) for `generate`, `check`, `info`, `secret`, custom paths, and overwrite handling; see [database migrations](database.md) for SQL ownership. In particular, `auth check` detects stale generated output, while `doctor` only checks structure. Neither proves database migrations have been applied.

## Delivery adapters

Use Stack's delivery helpers instead of duplicating console delivery and production checks:

| Helper                                  | Native callback or option                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `magicLink({ sendMagicLink })`          | Native magic-link plugin options; sender optional in development.            |
| `emailOTP({ sendVerificationOTP })`     | Native email-OTP plugin options; sender optional in development.             |
| `organization({ sendInvitationEmail })` | Native organization options and overloads, with wrapped invitation delivery. |
| `sendResetPassword(sender?)`            | `emailAndPassword.sendResetPassword`.                                        |
| `sendVerificationEmail(sender?)`        | `emailVerification.sendVerificationEmail`.                                   |
| `sendInvitationEmail(sender?)`          | Native invitation callback when composing that callback explicitly.          |
| `authDelivery(flow, sender?)`           | Generic typed callback composition for an application-defined delivery flow. |
| `validateAuthDelivery(options)`         | Explicit synchronous validation of configured Stack delivery callbacks.      |

Each callback preserves native arguments and awaits the supplied sender. During development it also logs readable delivery data through `browserLog`, even when a sender such as Mailpit is configured. Full-stack development reaches both the server console and every connected browser; backend-only development logs to the server. URLs print on their own lines, OTPs have a labeled code line, and invitation output includes its ID. Applications choose invitation URLs and acceptance routes.

Supplying a sender enables transport only; it does not enable an auth method. Sender failures retain native behavior. Console delivery alone does not establish successful email transport. Built applications disable development delivery regardless of runtime mode.

For production, pass application email callbacks into the helpers and plugin options. Keep runtime transport/credentials out of generation-time imports; runtime composition may replace the callback or plugin configuration while retaining the same schema-producing options. Applications own email provider selection, message contents, and transport configuration.

`authHelpers.elysia()` registers a validation gate that `startServer` awaits after native plugin initialization and before listening. A configured wrapped flow without a sender fails production/built startup. Standalone native hosts must `await authHelpers.validate()` at their corresponding pre-listen boundary; it awaits native context initialization before calling `validateAuthDelivery`. The lower-level function takes already-composed native options and does not initialize plugins itself. Builds and schema generation need no senders. Native callbacks outside Stack's wrappers retain their native behavior.

## Bound server helpers

Bind `createAuthHelpers(auth)` once per native instance and reuse it. All request helpers accept an Elysia-compatible context or a plain `Request`. Pass context when available: helpers propagate native refreshed session cookies into `set.headers`, preserving existing cookies. Plain-Request callers own outgoing cookie delivery. Session resolution is cached per request rather than across users or requests, and inferred additional user/session fields are retained.

| Returned method                      | Result and use                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSession(input)`                  | Native inferred session/user pair, or `null`.                                                                                                                  |
| `getUser(input)`                     | Native inferred user, or `null`.                                                                                                                               |
| `requireSession(input)`              | Session pair, or a 401 response.                                                                                                                               |
| `getOrganizationBySlug(input, slug)` | Authorized native organization result, or `null` for anonymous/missing/inaccessible organizations. Requires the organization plugin.                           |
| `requireOrganization(input, slug)`   | Organization, 401 when anonymous, or 404 when absent/inaccessible.                                                                                             |
| `getMembership(input, slug)`         | Current user's native membership, or `null`; filters the native list endpoint by user ID rather than scanning a member page. Requires the organization plugin. |
| `requireMembership(input, slug)`     | Membership, 401 when anonymous, or 404 when absent/inaccessible.                                                                                               |
| `elysia()`                           | Native handler mount, startup validation registration, and `auth: true` macro.                                                                                 |
| `validate()`                         | Awaited pre-listen delivery validation for standalone hosts.                                                                                                   |

Required helpers advertise `ElysiaCustomStatusResponse` failure branches. Without the request logger, these failures are returned status values; return them from explicit handlers so Elysia and Eden see the declared failure contract:

```ts
import { Elysia, ElysiaCustomStatusResponse } from "@prinpo/stack/server";

import { authHelpers } from "./auth/instance";

export const accountRoutes = new Elysia()
  .use(authHelpers.elysia())
  .get("/api/profile", ({ user, session }) => ({ user, session }), { auth: true })
  .get("/api/organizations/:slug/membership", async (context) => {
    const member = await authHelpers.requireMembership(context, context.params.slug);
    if (member instanceof ElysiaCustomStatusResponse) return member;
    return { id: member.id, role: member.role };
  });
```

The macro injects typed `user` and `session` and handles anonymous 401 responses. With Stack's request logger registered first, required-helper failures call its throwing `apiError` helper and use its structured serializer while retaining the advertised failure type. See [logging and public errors](logger.md). Infrastructure errors propagate normally.

Organization helpers do not select a session's active organization. Applications own URL selection, onboarding, organization creation, roles/permissions, and authorization beyond membership. Native organization authorization remains authoritative.

## Browser client and organization lookup

```ts
// src/client/auth.ts
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
```

Use the native client actions/hooks for signup, password login, OTP, magic links, sessions, organization creation/invitations, and last login method. The React entry provides native hooks; the non-React `/auth/client` entry provides the native client. For custom fields, add `inferAdditionalFields<typeof auth>()` and `inferOrgAdditionalFields<typeof auth>()` from `/auth/client/plugins` with a **type-only** import of the server auth instance. Browser modules must remain independent of runtime database and server credentials.

- `organizationBySlug(client, slug)` delegates to `client.organization.getFullOrganization({ query: { organizationSlug: slug } })` and returns its native result.
- `useOrganizationBySlug(client, slug)` returns `data`, `error`, `isPending`, and `refetch`. It follows native session changes and hides the previous user's/session's result immediately. It does not select an active organization or maintain a separate shared session cache. Refetch after application mutations that change the organization.

Last login method uses native browser-cookie behavior by default, with native persistence options still available. Social sign-on also remains native: configure `socialProviders` on the server, set the provider callback URL, then call the client's `signIn.social` action. Keep OAuth credentials in runtime server configuration. For exhaustive method/plugin options use the [official Better Auth documentation](https://better-auth.com/docs); Stack adds no separate authentication configuration language.
