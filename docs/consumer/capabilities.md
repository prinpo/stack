---
title: Stack capability map
description: Coverage inventory of Blocks, public helpers, application patterns, development tooling, CLI commands, and production workflows.
type: index
topics: [inventory, blocks, utilities, imports, workflows]
related:
  title: References
  links:
    [
      README.md,
      application-patterns.md,
      frontend.md,
      backend.md,
      eden-query.md,
      env.md,
      database.md,
      auth.md,
      logger.md,
      development.md,
      cli.md,
      production.md,
    ]
---

# Stack capability map

A **Block** is a composable Stack capability, usable independently wherever its underlying libraries allow. The groups below are navigation views: helpers remain documented alongside their owning capability. Use all applicable Stack facilities; enabling every Block is optional.

## Blocks

| Capability                         | Public imports                                                   | Canonical reference         |
| ---------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| React and TanStack Router frontend | `@prinpo/stack/react`, `@prinpo/stack/devtools`                  | [Frontend](frontend.md)     |
| Elysia backend                     | `@prinpo/stack/server`                                           | [Backend](backend.md)       |
| Eden typed API client              | `@prinpo/stack/client`                                           | [Backend](backend.md)       |
| TanStack Query and Eden connector  | `@prinpo/stack/query`                                            | [Eden Query](eden-query.md) |
| Varlock environment                | `@prinpo/stack/env`, `/env/server`, `/env/vite`, `/env/defaults` | [Environment](env.md)       |
| Drizzle database                   | `@prinpo/stack/database`, matching `/database/*` ORM subpaths    | [Database](database.md)     |
| Better Auth                        | `@prinpo/stack/auth` and supported auth subpaths below           | [Authentication](auth.md)   |
| evlog logging                      | `@prinpo/stack/logger`, `/logger/elysia`, `/logger/client`       | [Logging](logger.md)        |

## Utilities and helpers

| Owner             | Stack facilities                                                                                                                                                                                                                                                                     | Reference                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Frontend          | `createRootAndRender`; native Router APIs and devtools                                                                                                                                                                                                                               | [Frontend](frontend.md)     |
| Backend           | `startServer`, `StartServerOptions`, `serveApp`, `ServeAppOptions`, `startFrontend`; native Elysia/Eden                                                                                                                                                                              | [Backend](backend.md)       |
| Query             | `createApiClient`, `ApiClient`, `CreateApiClientOptions`; returned `api`, `eden`, `queryClient`, `ApiProvider`                                                                                                                                                                       | [Eden Query](eden-query.md) |
| Query connector   | `createEdenOptionsProxy`, `createEdenContext`, `createEdenTanStackQuery`, `edenQueryOptions`, `edenMutationOptions`, `edenInfiniteQueryOptions`, `getQueryKey`, `getMutationKey`; option, key, decorator, inference and utility types                                                | [Eden Query](eden-query.md) |
| Environment       | `ENV`, `PublicTypedEnvSchema`, `TypedEnvSchema`; `ServerEnvOptions`, `loadServerEnv`, `loadStaticEnv`, `readServerConnection`, `readClientEnv`, `readLogDirectory`, `validateClientEnv`, `validateEnvCodegenPaths`; `varlockVitePlugin`, `VarlockVitePluginOptions`; defaults schema | [Environment](env.md)       |
| Database          | `defineConfig`, `DatabaseConfig`; native ORM root, dialects, drivers, migrators, relations and schema-validation subpaths                                                                                                                                                            | [Database](database.md)     |
| Auth server       | `createAuthHelpers`; bound `getSession`, `getUser`, `requireSession`, `getOrganizationBySlug`, `requireOrganization`, `getMembership`, `requireMembership`, `elysia`, `validate`                                                                                                     | [Authentication](auth.md)   |
| Auth delivery     | `authDelivery`, `sendResetPassword`, `sendVerificationEmail`, `validateAuthDelivery`; wrapped `magicLink`, `emailOTP`, `organization`, `sendInvitationEmail`                                                                                                                         | [Authentication](auth.md)   |
| Auth browser      | `organizationBySlug`, `useOrganizationBySlug`; native clients and plugins                                                                                                                                                                                                            | [Authentication](auth.md)   |
| Auth import paths | `/auth/client`, `/auth/react`, `/auth/client/plugins`, `/auth/plugins`, `/auth/plugins/organization`, `/auth/adapters/drizzle`, `/auth/plugins/magic-link`, `/auth/plugins/email-otp`                                                                                                | [Authentication](auth.md)   |
| Logging           | `logger`, `LoggerOptions`, request-context `apiError`; `isStructuredApiError`, `StructuredApiError`; native evlog configuration/error APIs                                                                                                                                           | [Logging](logger.md)        |
| Browser logs      | `browserLog` from `/browser-log` or `/logger`; `/browser-log/built` build exclusion marker                                                                                                                                                                                           | [Logging](logger.md)        |

## Application patterns

| Pattern                                                                                                                           | Canonical reference                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Required entries/configuration and recommended feature-oriented directory structure; generated-file ownership; independent Blocks | [Application patterns](application-patterns.md) |
| Browser/server boundary, native Router type registration, route/view separation                                                   | [Frontend](frontend.md)                         |
| Deferred application import after environment validation, modular routes/plugins/validation, type-only API contract               | [Backend](backend.md)                           |
| Shared Query cache in components/loaders, typed errors, application-owned mutation policies                                       | [Eden Query](eden-query.md)                     |
| Schema-derived request validation, one managed database, migration ownership                                                      | [Database](database.md)                         |
| Auth generation/runtime separation, sessions versus membership, URL-scoped organizations, application-owned UI/delivery           | [Authentication](auth.md)                       |
| Environment classification, profile selection, public-only client delivery                                                        | [Environment](env.md)                           |

## Development tooling

| Capability                                                                                                                                        | Canonical reference                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `stack()` Vite preset and `StackOptions`: React, file-route generation/splitting, shared React resolution, API proxy, native React/Router options | [Frontend](frontend.md)                         |
| Native router devtools                                                                                                                            | [Frontend](frontend.md)                         |
| Environment build replacement and development/runtime HTML configuration                                                                          | [Environment](env.md)                           |
| One development session for frontend/backend, watch/restart behavior, optional `docker-compose.dev.yml`, readiness and cleanup                    | [Development](development.md)                   |
| Explicit server-to-browser logs and auth development delivery                                                                                     | [Logging](logger.md), [Authentication](auth.md) |

## CLI

All command workflows, machine output, flags, help, exit statuses, and diagnostic boundaries are owned by the [CLI reference](cli.md).

| Area        | Commands                                                                                |
| ----------- | --------------------------------------------------------------------------------------- |
| Application | `dev`, `build`, `start`; profile selection                                              |
| Diagnostics | `doctor`, `doctor --json`, `logs`, log selectors/filters, `--json`, `--follow`, `--dir` |
| Environment | `env load`, `env codegen`, `env run`                                                    |
| Database    | `db generate`, `migrate`, `push`, `pull`, `studio`, `check`, `up`, `export`             |
| Auth        | `auth generate`, `check`, `info`, `secret`                                              |
| Discovery   | `--help`, leaf-command help, `--version`                                                |

## Build and production

[Production](production.md) owns credential-free builds, output manifests, build assets, profile selection, runtime public configuration, startup migrations, frontend-only serving, SPA fallback/API 404 behavior, process handoff, and shutdown. Detailed environment, database, and auth contracts remain in their capability guides.

## Native API coverage and boundaries

Native exports are documented by library and import path; upstream references in the owning guides cover their full APIs. `@prinpo/stack/package.json` exposes the installed version, export map, dependency versions, and peer requirements. The database wildcard mirrors installed Drizzle ORM subpaths; optional adapters retain their native dependency requirements.

Applications own UI, business rules, mutation feedback, authorization policy, deployment infrastructure, external delivery providers, optional drivers, and production process supervision. The supported CLI baseline is Linux and Bun. SSR, generators, production Docker orchestration, and hosted log aggregation are outside the provided capabilities.
