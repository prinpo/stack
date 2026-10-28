# Optional Varlock environment Block

Stack integrates Varlock 1.23.0 and its Vite integration 1.5.4 through native schemas, typed access, and small integration helpers. Enable it explicitly; other Blocks do not load application configuration.

## Schemas and timing

Keep separate client and server schema directories. Use native selective `@import()` for shared definitions, as in [the full-stack example](../examples/fullstack/env/client/.env.schema). No separate package manifests are needed.

Start each schema with sensitive defaults and disabled runtime interception:

```dotenv
# @defaultSensitive=true
# @redact=false @preventLeaks=false
# @generateTsTypes(path=../../src/env/client.ts, exposeEnv=local, icons=false)
# ---

# @public
APP_TITLE="My application"

# @public @dynamic @required
PUBLIC_API_ORIGIN=
```

Sensitivity and timing are independent. Sensitive values default to dynamic; explicitly public values default to static unless marked `@dynamic`. Commit public static metadata when it is intentionally identical across deployments of an artifact. Keep credentials dynamic. Set private local values in ignored `.env.local` files under the appropriate schema directory, or inject them into the runtime environment.

Generate local types with `varlock codegen --path ./env/client` and the corresponding server command. Native generated modules import `varlock/env` themselves; do not edit those imports. Application code imports their named `ENV` export. Local generation prevents client/server type declarations from merging; it does not create independent stores inside one process. Browser and server run in separate processes.

```ts
import { ENV } from "./env/client";

const title: string = ENV.APP_TITLE;
```

Use native `ENV.KEY` expressions for compile-time replacements. Renamed bindings, destructuring, and computed property access are not qualified static replacement patterns. Import `ENV` from `@prinpo/stack/env` when using native global type generation instead.

## Browser tooling

Point the application's `package.json` at its client schema:

```json
{ "varlock": { "loadPath": "./env/client/" } }
```

```ts
import { varlockVitePlugin } from "@prinpo/stack/env/vite";
import { stack } from "@prinpo/stack/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [varlockVitePlugin(), stack({ api: { target: "http://localhost:3000" } })],
});
```

The async factory returns native Varlock plugins. Register it once, first, and use this Stack import instead of separately importing the upstream plugin: upstream captures its loading mode when its module first loads. The native options remain available. This client integration is for SPA/browser compilation; do not use it to compile server/SSR schemas.

The client graph, including imported definitions, must contain only explicitly public items. `@sensitive=false` is the native equivalent of `@public`. Public defaults or prefix inference alone do not grant exposure. Exposure and timing decorators must be literal during static-only loading: references and direct runtime function calls are rejected before classification runs. Other metadata on dynamic backend entries, such as conditional required checks, is left for startup validation. Static items may depend only on static items; mark a parent dynamic if it depends on a dynamic item.

Builds validate static values and generate complete schema types while retaining unresolved dynamic metadata. They skip dynamic item value resolvers and required-value checks; the server checks required runtime values at startup. Schema loading and plugin initialization still occur, so application-owned custom plugins must not fetch runtime credentials during schema initialization. Provider-bearing definitions belong in the server graph.

## Server startup and the public endpoint

Disable Bun's automatic dotenv loading in the application's `bunfig.toml`:

```toml
env = false
```

Validate before launching the server:

```sh
varlock run --path ./env/server -- bun src/server/index.ts
```

The server entry imports `@prinpo/stack/env/auto-load`. This requires the graph injected by `varlock run`, retains its explicitly selected server schema even when the package default belongs to the client, and initializes native Varlock runtime behavior. Importing it without CLI-injected configuration fails with startup instructions. Do not give it an unchecked or fabricated graph.

```ts
import "@prinpo/stack/env/auto-load";
import { publicEnv } from "@prinpo/stack/env/elysia";
import { Elysia } from "@prinpo/stack/server";

const app = new Elysia().use(publicEnv({ keys: ["PUBLIC_API_ORIGIN"] }));
```

The endpoint defaults to `/api/public-env`; configure `path` when needed. Its explicit key list must be a subset of initialized public dynamic keys. Sensitive, static, or undeclared selections fail registration. An empty selection returns `{}`. Backend-only public settings are not exposed automatically. The endpoint returns the process's startup snapshot and sends `Cache-Control: no-store`.

Bootstrap the browser before importing application modules that may read configuration:

```ts
import { loadPublicDynamicEnv } from "@prinpo/stack/env";

await loadPublicDynamicEnv({ endpoint: "/api/public-env" });
await import("./application");
```

The example adds a retryable startup error. Static-only clients omit this fetch. Native hydration rejects request failures but does not validate per-key types or required-key completeness; the initialized server graph is the validation authority. Other servers can use native `getPublicDynamicEnv` and hydration helpers directly, with an explicit browser subset and equivalent cache policy.

For a separate backend origin, configure the endpoint URL before bootstrap through deployment serving configuration or a known same-origin route/proxy. A dynamic API origin cannot also be the only way to discover the configuration endpoint. Keep native CORS/credential policy application-owned.

Changes require restarting the full `varlock run` command. Bun's inner code watcher alone reuses the parent's snapshot; it does not reload environment values. Vite watches its schema sources and regenerates client metadata/types on configuration restart. Rebuild when static values change.

## Builds and runtime safeguards

The example's `build` command compiles browser and Bun server artifacts without deployment values. Its backend build first validates static inputs using the patched CLI's `_VARLOCK_STATIC_ONLY=1` mode, then runs `bun build --target bun --packages external`. This switch applies to `varlock load`, not runtime `run`; it must not be combined with item filters or trusted frozen configuration. Runtime startup fully resolves and validates the server graph.

Automatic output redaction and response scanning are disabled by schema settings. Developers own the responsibility to avoid logging or returning credentials. Native experimental opt-ins remain available, but this integration does not qualify their performance or evlog compatibility and adds no custom logging drains. Disabling interception does not remove configuration loading overhead.

## Pinned upstream patches

The user authorized two narrow patches after the compatibility probe reproduced upstream gaps:

- `patches/varlock@1.23.0.patch`: opt-in static-only loading preserves dynamic metadata, rejects dynamic dependencies of static inputs and computed classification, and optionally enforces a public-only client graph. Stack's Vite factory scopes `_VARLOCK_STATIC_ONLY=1` and `_VARLOCK_PUBLIC_ONLY=1` around the first upstream import; the upstream plugin retains that CLI environment for reloads.
- `patches/@varlock%2Fvite-integration@1.5.4.patch`: emitted browser entry chunks receive public dynamic metadata even when Rolldown's earlier module transforms do not identify the HTML entry. Server/SSR output is excluded from this additional injection.

The root Bun manifest and lockfile apply the patches in this source-linked repository. **Bun root patches do not automatically propagate through an installed dependency's manifest.** A separate consuming repository must configure these patches in its own root; including patch assets in Stack is not automatic application. Package distribution remains deferred under ADR 0004, so this milestone qualifies the repository example rather than an independently installed package. Do not remove the patches merely because unfiltered builds happen to succeed with development values present.

On upgrades, rerun `bunx --bun vp run research:varlock`, the environment tests, and the full-stack build before updating pins or dropping patches. The probe builds one artifact without dynamic values, loads it under two runtime payloads, checks import ordering and retry, and rejects sensitive/implicitly public imported entries. happy-dom supplies browser globals; this is not real-browser E2E.

Native references: [schemas](https://varlock.dev/guides/schema/), [monorepos](https://varlock.dev/guides/monorepos/), [dynamic values](https://varlock.dev/guides/dynamic-config/), [Bun](https://varlock.dev/integrations/bun/), and [providers](https://varlock.dev/guides/plugins/).
