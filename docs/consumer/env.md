---
title: Environment Block
description: Define independent server and public-client schemas, generate typed access, and use Stack's configuration validation and runtime delivery helpers.
type: reference
topics: [environment, varlock, schemas, configuration, codegen, vite]
related:
  title: Related
  links: [cli.md, frontend.md, backend.md, production.md, application-patterns.md]
---

# Environment Block

Stack integrates Varlock for schema-driven configuration, typed access, static build validation, and public dynamic browser configuration. Standard `startServer` validates configuration before importing the application or listening. Native Elysia imports alone initialize no environment lifecycle. Low-level helpers remain independently usable.

## Public import paths

| Import path                  | Exports and purpose                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `@prinpo/stack/env`          | Native browser-safe `ENV`, `TypedEnvSchema`, and `PublicTypedEnvSchema` from Varlock       |
| `@prinpo/stack/env/server`   | Node/Bun-only loading, inspection, and validation helpers listed below; `ServerEnvOptions` |
| `@prinpo/stack/env/vite`     | `varlockVitePlugin` and `VarlockVitePluginOptions` for custom browser tooling              |
| `@prinpo/stack/env/defaults` | Stack's owned environment schema asset; normally included automatically                    |

Prefer a local generated `ENV` accessor for application settings. Generated modules retain Varlock's native `varlock/env` import; application code imports the generated module. Stack owns the compatible Varlock version; optional provider plugins and their authentication setup belong to the application.

## Schemas, values, and typed access

Use independent root directories `env/server/` and `env/client/`, each with its own `.env.schema` and values files. Client definitions are explicitly public; server definitions contain backend settings and credentials. Keep client definitions separate from the server graph: Stack delivers them without importing one schema into the other or repeating exposure key lists in application code.

A client schema can declare both artifact-time and deployment-time settings:

```dotenv
# @defaultSensitive=true
# @redact=false @preventLeaks=false
# @generateTsTypes(path=../../src/env-gen/client.ts, exposeEnv=local, icons=false)
# ---

# @public @static @required @type=string
CLIENT_PUBLIC_STATIC=

# @public @dynamic @required @type=string
CLIENT_PUBLIC_DYNAMIC=
```

For server schema generation, use `@generateTsTypes(path=../../src/env-gen/server.ts, exposeEnv=local, icons=false)`. Paths are relative to the declaring schema file and must be literal destinations inside `src/env-gen/`. Filenames/subdirectories inside that directory are application-owned. Stack validates destinations before resolution or generation, including `env load`, `env run`, `env codegen`, runtime startup, and builds. Edit schema files and regenerate; exclude generated modules from linting and formatting.

```ts
import { ENV } from "./env-gen/client";

const title = ENV.CLIENT_PUBLIC_STATIC;
const deploymentLabel = ENV.CLIENT_PUBLIC_DYNAMIC;
```

Use native `ENV.KEY` expressions for static browser replacement. Renamed bindings, destructuring, and computed keys are not the supported replacement form.

Values live beside the relevant schema:

| File                   | Use                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.env`                 | Committed defaults, including intended public static values                                                    |
| `.env.<profile>`       | Committed profile-specific nonsecret values                                                                    |
| `.env.<profile>.local` | Ignored local/deployment overrides, including server credentials                                               |
| `.env.local`           | Native shared local override; prefer profile-specific local files to keep development values out of production |

Varlock applies schema defaults, `.env`, `.env.local`, profile values, profile-local values, then genuine process overrides in increasing precedence. Declare credentials in the server schema before supplying values. Host-mounted secret files can use server `.env.production.local`; process overrides are also supported. Disable Bun's automatic dotenv loading with top-level `env = false` in `bunfig.toml` so Varlock owns precedence.

## Exposure and static/dynamic classification

Sensitivity and timing are independent. Sensitive settings default to dynamic; public settings default to static. Make deployment-dependent values dynamic even when public. Static inputs can depend only on static inputs; mark a dependent setting dynamic when any transitive dependency is dynamic.

Every client entry, including imported definitions, must explicitly declare `@public` or `@sensitive=false`. Prefixes/defaults that merely infer public status do not authorize exposure. Sensitive values stay outside the client graph. Exposure and static/dynamic annotations must be literal; value-dependent classification is rejected before client value resolvers run.

The documented schemas disable automatic output redaction and response leak scanning with `@redact=false @preventLeaks=false`. Keep credentials out of logs, responses, and public client definitions explicitly. Native experimental opt-ins remain application-owned; Stack does not qualify their performance or logging compatibility.

## Standard lifecycle and profiles

The backend entry defers application imports:

```ts
import { startServer } from "@prinpo/stack/server";

await startServer(() => import("./app"));
```

The loaded module exports a native Elysia instance named `app`. Environment validation runs before its modules evaluate. Standard startup requires no auto-load import, environment endpoint, exposure-key list, or custom HTML injection. See [backend](backend.md) for startup options and lifecycle.

Stack owns these declarations and validation; set their values without redeclaring their schemas:

| Setting    | Default       | Constraint                             |
| ---------- | ------------- | -------------------------------------- |
| `HOST`     | `127.0.0.1`   | Server bind host                       |
| `PORT`     | `3000`        | Integer from 1 through 65535           |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `APP_ENV`  | `NODE_ENV`    | Deployment-profile string              |

For container port exposure, choose `HOST=0.0.0.0` where appropriate. `dev` sets development mode; `build`/`start` set production mode. `--env` chooses the profile before inherited `APP_ENV`, then mode. Thus `stack start --env staging` uses production serving/logging with `.env.staging` values. Vite's native mode does not select `APP_ENV`.

Standard server/client locations are `env/server` and `env/client`. Missing conventional directories are allowed for default-only applications. Explicit missing paths fail. Lower-level startup accepts custom paths through `startServer(..., { env: { server: "config/server", client: "config/client" } })`; `client: false` supports backend-only startup. Stack CLI still uses its conventional root schema locations.

A compatible native CLI snapshot is reused to avoid resolving credential providers twice. A mode/profile change discards incompatible snapshot-injected values while preserving genuine process overrides. Set mode/profile before direct Bun startup, and restart after runtime configuration changes.

## Browser configuration delivery

The [Stack Vite preset](frontend.md) detects conventional client schemas automatically. Development resolves public client dynamics directly when preparing HTML, with no backend dependency or browser fetch. Server startup leaves development client resolution to Vite. Browser builds validate and compile public static values without resolving dynamic deployment credentials.

Production startup resolves public client dynamic values and their dependencies separately from the server ENV store, then prepares an in-memory HTML shell before browser modules evaluate. Build-only client static values are not required again at runtime. No configuration endpoint, manual hydration hook, or key-selection code is needed. The shell is shared by root, index, and SPA navigation; [production](production.md) covers caching and artifact reuse.

For a custom Vite integration, `varlockVitePlugin(options)` returns a promise of Vite plugins. Its options are:

| Option                                            | Meaning                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `client?: string`                                 | Client schema directory, resolved from the selected project root; otherwise conventional `env/client` or the project root |
| `profile?: string \| (() => string \| undefined)` | Explicit profile; fallback is `APP_ENV`, `NODE_ENV`, then development                                                     |
| `rootDir?: string \| (() => string)`              | Override the schema/project search root                                                                                   |
| `optional?: boolean`                              | Skip integration when the conventional or explicit client schema is absent; default false                                 |

The standard preset supplies this wiring. Add the standalone plugin only when composing browser tooling independently. `%ENV.KEY%` HTML replacements require public static items. Client dynamic delivery uses native boot-time hydration. SSR is outside the qualified integration.

## Server helper reference

Use the standard lifecycle unless custom scripts/tooling need a narrower operation. Paths are resolved from the application working directory unless an explicit root is accepted.

| Helper                                                                           | Inputs and result                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loadServerEnv(options?: ServerEnvOptions)`                                      | `server?: string`, `client?: string \| false`; initializes one shared snapshot per process and returns `{ host, port, mode, profile, clientKeys, clientValues }`. Production captures client dynamics unless disabled. Later calls share the first initialization. |
| `readServerConnection({ server?, root?, profile? } = {})`                        | Resolves only owned connection settings and their dependencies; returns `{ host, port, mode, profile }` without unrelated backend credentials.                                                                                                                     |
| `readClientEnv({ client?, root?, profile? } = {})`                               | Validates and resolves client dynamics, returning `{ clientKeys, clientValues }` without replacing the server's ENV store. Missing conventional schema yields an empty snapshot; explicit missing schema fails.                                                    |
| `readLogDirectory(profile?: string)`                                             | Resolves only `LOG_DIR` and its dependencies; falls back to inherited `LOG_DIR` or `.evlog/logs` when undeclared. A declared value must be a nonempty string.                                                                                                      |
| `loadStaticEnv(paths: string[], { profile?, publicOnly?, values?, root? } = {})` | Classifies without dynamic resolution, rejects static dependencies on dynamic inputs, validates static values, runs generators, and returns a native serialized graph. `publicOnly` also enforces client exposure. `values` supplies process overrides.            |
| `validateClientEnv(paths: string[], profile?: string)`                           | Validates client exposure/classification without resolving values.                                                                                                                                                                                                 |
| `validateEnvCodegenPaths(paths: string[], profile?: string)`                     | Checks literal generation destinations before native CLI operations can write files; resolves no environment values and writes no files.                                                                                                                           |

`ServerEnvOptions`, `TypedEnvSchema`, `PublicTypedEnvSchema`, and `VarlockVitePluginOptions` preserve typed integration. Graph-level helpers belong in server/tooling code, not browser bundles. Standard Stack operation requires no package patches or consumer patch configuration.

Use [CLI environment operations](cli.md) for inspection, generation, and running scripts. Native schema/provider references: [Varlock schemas](https://varlock.dev/guides/schema/), [dynamic configuration](https://varlock.dev/guides/dynamic-config/), [providers](https://varlock.dev/guides/plugins/), and [Bun integration](https://varlock.dev/integrations/bun/).
