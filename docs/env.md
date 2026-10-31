# Varlock environment integration

Varlock is standard in Stack's `startServer` lifecycle. It loads and validates configuration before importing application modules or opening a listener. Importing native Elysia exports alone does not load schemas. Browser and low-level helpers remain independently usable.

## Schemas and files

Use two independent directories: `env/server` and `env/client`. Each setting's values live beside its schema. Client schemas contain explicitly public static and dynamic definitions; server schemas contain backend settings and credentials. Do not import the client schema into the server schema or repeat client keys in TypeScript delivery code. Vite resolves the client snapshot locally during development; production startup resolves it using the active server profile. Both deliver the declared public dynamic settings automatically.

Keep native schema annotations and locally generated typed access:

```dotenv
# @defaultSensitive=true
# @redact=false @preventLeaks=false
# @generateTsTypes(path=../../src/env/client.ts, exposeEnv=local, icons=false)
# ---

# @public @static @required @type=string
CLIENT_PUBLIC_STATIC=

# @public @dynamic @required @type=string
CLIENT_PUBLIC_DYNAMIC=
```

Static public client values belong in committed `env/client/.env` files. Profile-specific values belong in `.env.development` / `.env.production`. Public local overrides stay in the client directory; developer credentials stay in `env/server/.env.development.local`, and host-provided production credentials in `env/server/.env.production.local`. Local files are ignored and may be mounted into containers. Declare credentials in the server schema before setting their values.

Sensitivity and timing are independent: sensitive values default to dynamic, public values default to static. Static inputs may depend only on static inputs. Every client entry, including imported definitions, must explicitly declare `@public` (or `@sensitive=false`); inferred public prefixes/defaults do not grant exposure. Exposure and timing annotations must be literal. Stack checks this before resolving client values, so a mistaken client secret cannot trigger a credential resolver before rejection.

Varlock applies schema defaults, `.env`, `.env.local`, the selected profile, its `.local` override, then genuine process overrides in increasing precedence. Prefer profile-specific local files to keep development credentials out of production. Disable Bun's automatic dotenv loading with `env = false` in `bunfig.toml`; Varlock owns loading and precedence.

Generate each schema's local types with native `varlock codegen --path ./env/client` and the corresponding server command. Generated files import `varlock/env`; application modules import their local named `ENV` export. Browser and server execute in separate processes; Stack's loader keeps client values separate from the server's process-wide ENV store. Use native `ENV.KEY` expressions for client static replacement, without renamed bindings, destructuring, or computed keys.

## Standard server startup

```ts
import { startServer } from "@prinpo/stack/server";

await startServer(() => import("./app"));
```

The deferred import is required: application modules may read configuration during evaluation. `./app` exports a native Elysia instance named `app`. Stack initializes the server snapshot, then imports the app, prepares production HTML, waits for plugins, and opens the listener. It registers no environment-fetch endpoint. Apps need no auto-load import, exposure key lists, manual endpoint registration, or HTML injection wiring.

Stack owns validation and defaults for `HOST=127.0.0.1`, `PORT=3000` (integer 1–65535), and `NODE_ENV=development` (development/test/production). Override these in server `.env` files or process variables without redeclaring their schemas. The startup snapshot returned by `loadServerEnv` from `@prinpo/stack/env/server` exposes typed `host`, `port`, and `mode` settings; app-generated schema types contain application settings. For a container reachable through published ports, set `HOST=0.0.0.0` in its production server file.

The default server/client paths are `env/server` and `env/client`. Configure `startServer(..., { env: { server: "config/server", client: "config/client" } })` for another layout, or `client: false` for a backend-only application without browser serving. Missing conventional directories are supported for apps that need only Stack defaults; explicit missing paths fail. `assets` defaults to `dist`, `apiPrefix` to `/api`, and custom `transformIndexHtml` runs before Stack's injection.

Development runs the server entry directly. The example retains `varlock run --path ./env/server/.env.start` for production profile selection until the planned CLI owns it. Stack reuses the CLI's validated application snapshot rather than resolving credential providers again, and applies its owned connection validation separately. Other launchers can set `NODE_ENV` before startup. Replacing build/profile commands with a Stack CLI is outside this change.

Client static values are validated during browser builds and embedded in the artifact. Production startup resolves only client dynamic values and their dependencies; development startup leaves all client resolution to Vite. It does not require build-only client static values again. Changes to runtime values require restarting the full startup command. Native redaction/scanning settings remain application-owned.

## Development browser tooling

Point `package.json` at the client schema for native Varlock tooling:

```json
{ "varlock": { "loadPath": "./env/client/" } }
```

```ts
import { stack } from "@prinpo/stack/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({ plugins: [stack({ api: true })] });
```

The preset includes the native Varlock browser plugins and development HTML delivery. It reads `HOST`, `PORT`, and `NODE_ENV` from the backend files using Stack's defaults and the same profile. Only those settings and their dependencies resolve; unrelated backend credential value resolvers do not run. Application-owned plugins must still avoid fetching credentials during schema initialization. The derived address is used only for API proxy requests; client configuration is loaded directly from its own files. Wildcard bind addresses map to `127.0.0.1` for proxy connections; `PORT=0` is unsupported. Restart the development command after changing connection settings.

Use `api: { prefix: "/rpc", serverEnv: "config/server" }` for another namespace/path. An explicit `api: { target: "https://backend.example" }` retains the standalone proxy behavior without implicit local-schema loading; compose the standalone `varlockVitePlugin` from `@prinpo/stack/env/vite` when manually configuring browser env delivery. Omitting `api` keeps frontend-only React/router tooling independent.

On HTML requests, Vite uses the shared Node-only `readClientEnv` resolver from `@prinpo/stack/env/server` to validate and resolve public dynamic values directly from the client schema and files. There is no configuration HTTP request, timeout, or backend startup dependency. The managed preset uses the backend's selected profile, while the standalone plugin defaults to Vite's mode. `varlockVitePlugin({ client: "config/client", profile: "development" })` supports explicit standalone overrides. Native schema watching still refreshes static compilation; client dynamic values are re-read when preparing HTML. Build execution does not resolve backend connection settings or contact a running backend. Static-only client compilation validates its required static inputs while preserving unresolved dynamic metadata, so deployment credentials are unnecessary.

## HTML delivery

Production startup uses Bun HTMLRewriter once to prepare an in-memory document, leaving files unchanged. Both dev and production emit Varlock's native key metadata and boot-time hydration global before application dependencies evaluate. Static imports in one browser `main.tsx` work in both modes. Script serialization escapes closing markup and Unicode line separators.

Production documents use `Cache-Control: no-store`. Root, explicit index, and SPA deep links share the prepared shell, including HEAD handling. Static assets and API misses retain their normal behavior. Applications using CSP must authorize the inline script, for example with a hash; Stack does not weaken CSP.

`src/env/html.ts` owns the shared script serialization and production HTML injection. It has no Elysia dependency. Runtime initialization lives inside the server loader; there is no separate auto-load entry point. The browser-safe `@prinpo/stack/env` entry exposes native `ENV` and schema types. Endpoint helpers, manual key-selection adapters, and manual hydration exports have been removed; Stack owns client delivery. The generic `serveApp.transformIndexHtml` hook remains available for application-owned HTML changes.

The earlier deferred check for missing keys in fetched development payloads is obsolete: development now resolves and validates values through Varlock directly. Qualification of absent optional values during native boot-time hydration remains separate; custom integrations using native Varlock hydration remain outside the standard Stack flow.

## Builds and runtime safeguards

The example's `build` command compiles browser and Bun server artifacts without deployment values. Its backend build first validates static inputs using the patched CLI's `_VARLOCK_STATIC_ONLY=1` mode, then runs `bun build --target bun --packages external`. This switch applies to `varlock load`, not runtime `run`; it must not be combined with item filters or trusted frozen configuration. Runtime startup fully resolves and validates the server graph.

Automatic output redaction and response scanning are disabled by schema settings. Developers own the responsibility to avoid logging or returning credentials. Native experimental opt-ins remain available, but this integration does not qualify their performance or evlog compatibility and adds no custom logging drains. Disabling interception does not remove configuration loading overhead.

## Pinned upstream patches

Only `patches/varlock@1.23.0.patch` remains required. It adds static-only loading that preserves dynamic metadata, rejects dynamic dependencies of static inputs and computed classification, and enforces the public-only client graph. Stack's Vite factory scopes `_VARLOCK_STATIC_ONLY=1` and `_VARLOCK_PUBLIC_ONLY=1` around the first upstream import; the native plugin retains that CLI environment for reloads.

The former Vite/Rolldown entry-metadata patch is no longer needed: both development and production now provide metadata in HTML before the bundle evaluates. The emitted-module probe passes against the unpatched Vite integration, including imported and lazy modules. The patch file, manifest entry, and lockfile registration were removed; the dependency remains pinned at the same version.

The root Bun manifest and lockfile apply the remaining patch in this source-linked repository. **Bun root patches do not automatically propagate through an installed dependency's manifest.** A separate consuming repository must configure this core patch in its own root; including its asset in Stack is not automatic application. Package distribution remains deferred under ADR 0004, so this qualifies the repository example rather than independently installed packages.

The standard loader uses the pinned native `internal.loadEnvGraph` interface to keep graphs independent and resolve only selected settings. Its classification adapter also relies on the maintained metadata patch. Treat these as qualified pinned interfaces, with the runtime integration tests covering upgrades.

On upgrades, rerun `bunx --bun vp run research:varlock`, the environment tests, and the full-stack build before updating pins or dropping the core patch. The probe builds one artifact without dynamic values, serves it under different runtime configurations, checks startup injection, import ordering without browser fetches, safe serialization, local development resolution without a backend, and rejects sensitive/implicitly public imported entries. happy-dom supplies browser globals; this is not real-browser E2E.

Native references: [schemas](https://varlock.dev/guides/schema/), [monorepos](https://varlock.dev/guides/monorepos/), [dynamic values](https://varlock.dev/guides/dynamic-config/), [Bun](https://varlock.dev/integrations/bun/), and [providers](https://varlock.dev/guides/plugins/).

## Runnable sandbox

The full-stack landing page names its browser settings `CLIENT_PUBLIC_STATIC` and `CLIENT_PUBLIC_DYNAMIC`. Four server settings demonstrate the public/secret and static/dynamic combinations: `SERVER_PUBLIC_STATIC`, `SERVER_PUBLIC_DYNAMIC`, `SERVER_SECRET_STATIC`, and `SERVER_SECRET_DYNAMIC`. Values live alongside their schema. The page's button fetches `/api/env`; the browser document includes only declared client dynamic settings. Standard startup has no bootstrap endpoint.

The two secret-classified settings contain dummy strings, intentionally returned by this teaching endpoint. Do not put real credentials in them. Sensitivity metadata does not prohibit explicit response serialization when automatic leak scanning is disabled. The endpoint returns only its four named demo settings and never enumerates the server environment.

Browser static reads are compiled into the bundle. The current Bun server build keeps native runtime `ENV` reads, so server static and dynamic settings both come from the validated startup snapshot. Server static values additionally resolve during static-only build validation; the sandbox supplies committed fake values so builds require no real credentials. See the [sandbox walkthrough](../examples/fullstack/README.md#try-the-environment-sandbox).
