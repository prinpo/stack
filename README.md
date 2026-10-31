# @prinpo/stack

A thin application framework for Bun, Elysia, Eden, TanStack Router, and TanStack Query. Stack owns a tested set of library versions and connects their native APIs through a few utilities.

The foundation includes file-based routing, router devtools, a Vite preset, a development API proxy, and an Elysia serving plugin. The Eden Query connector adds typed queries and mutations. Standard server startup integrates [Varlock configuration](docs/env.md), including typed schemas and public runtime values. Optional logging integrates evlog. Database and auth integrations follow separately. See the [original milestone boundary](docs/milestones/0001-fullstack-foundation.md) and [architectural decisions](docs/adr/).

## Try the full-stack example

From the repository root:

```sh
bunx --bun vp install
bun run stack dev
```

Open <http://localhost:5173>. Elysia runs on port 3000. The example is a Bun workspace that imports Stack's TypeScript source directly through `@prinpo/stack/...`. Changes to the source feed into the running application without building, packing, or reinstalling Stack. `bunx --bun vp run dev` from the root starts the same example.

The [full-stack example](examples/fullstack/README.md) documents its files and development workflow. `examples/` is a place to try real scenarios and evaluate the DX.

## Application CLI

Stack includes a Bun-first `stack` executable for `dev`, `build`, `start`, `doctor`, local logs, and environment utilities. It detects frontend/backend entry files, owns conventional paths, and supports frontend-only production serving. APP_ENV selects deployment profiles independently of NODE_ENV and Vite mode; `stack start --env staging` runs a production build with staging configuration.

See the [CLI guide](docs/cli.md) for commands, defaults, machine output, and installation requirements. In this source-linked repository, `bun run stack <command>` targets the example; installed applications use the package's local `stack` executable.

## Public imports

| Import                        | Provides                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| `@prinpo/stack/server`        | Native Elysia exports, standard `startServer`, and low-level `serveApp` |
| `@prinpo/stack/client`        | Native Eden exports, including `treaty`                                 |
| `@prinpo/stack/logger`        | Native evlog utilities                                                  |
| `@prinpo/stack/logger/elysia` | Opt-in `logger` plugin and request-context `apiError`                   |
| `@prinpo/stack/logger/client` | Browser-safe `isStructuredApiError` guard                               |
| `@prinpo/stack/query`         | Native TanStack React Query exports and the Eden Query connector        |
| `@prinpo/stack/react`         | Native TanStack Router exports                                          |
| `@prinpo/stack/devtools`      | Native router devtools exports                                          |
| `@prinpo/stack/env`           | Browser-safe Varlock ENV access and schema types                        |
| `@prinpo/stack/env/server`    | Server startup, client snapshots, and connection settings               |
| `@prinpo/stack/env/vite`      | Opt-in native Vite plugins with static-only, public-only loading        |
| `@prinpo/stack/vite`          | The `stack` Vite preset                                                 |

Import React and React DOM from their upstream packages. They are optional peers; UI applications install compatible versions themselves. Other integrated libraries are pinned regular dependencies. Backend entry points can run without React installed. Frontend-only applications still install the shared dependency set and omit the backend configuration.

The root [package.json](package.json) defines `@prinpo/stack`, its source exports, pinned library dependencies, optional React peers, and development tools. `src/` contains source files only. The example is a private Bun workspace whose `file:../..` dependency links directly to the root package; no separate Stack workspace or self-dependency is needed.

Vite+ is application development tooling. The example's [package.json](examples/fullstack/package.json) shows the tested versions, Vite alias, and explicit Bun package-manager setting. Shared tooling versions stay aligned with the root. [bunfig.toml](bunfig.toml) selects Bun's hoisted linker so Stack and the example share the root `node_modules` and lockfile; conflicting dependency versions can require nested installations. The example also stores Vite's cache under the root `node_modules`.

When migrating an existing checkout from the former `src/` workspace layout, remove the generated root, `src/`, and example `node_modules` directories, then run `bun install --frozen-lockfile`. This one-time cleanup clears stale workspace links and install metadata.

## Browser tooling

```ts
import { stack } from "@prinpo/stack/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [stack({ api: true })],
});
```

The preset configures React, file-route generation, automatic route splitting, shared React resolution, and the optional API proxy. `api: true` includes Varlock and reads backend connection settings for proxying and resolves client configuration locally for HTML delivery. Use an explicit `api.target` for standalone proxying to another backend. By default, requests under `/api` keep their paths when forwarded to Elysia. `/apiary` remains a frontend path. Proxying preserves the browser's origin.

For a frontend-only application, use `stack()`. Configure `router.routesDirectory` and `router.generatedRouteTree` for a different layout, or pass other native Router plugin options through `router`. React plugin options go through `react`. A custom proxy namespace uses `api.prefix`, for example `/rpc`.

Router's `Register` and generated `FileRoutesByPath` declarations augment the native `@tanstack/react-router` module. Keep that native type-registration target even though application imports use Stack; the [example application](examples/fullstack/src/main.tsx) demonstrates it. Exclude generated files from formatting and linting, as the [example config](examples/fullstack/vite.config.ts) does.

## Server and Eden

```ts
import { Elysia, t } from "@prinpo/stack/server";

export const app = new Elysia().get(
  "/api/hello",
  ({ query }) => ({ message: `Hello, ${query.name}!` }),
  { query: t.Object({ name: t.String() }) },
);

export type App = typeof app;
```

Keep listening in a separate server entry point. Browser code imports the contract as a type:

```ts
import { treaty } from "@prinpo/stack/client";

import type { App } from "./server/app";

export const api = treaty<App>(window.location.origin);
const { data, error } = await api.api.hello.get({ query: { name: "Stack" } });
```

The origin excludes `/api`: Elysia's route types already include that namespace. For a separately deployed backend, supply its explicit origin. Eden retains its native request, response, and error handling.

## Eden and TanStack Query

Import native Query hooks and the connector through `@prinpo/stack/query`:

```ts
import { createApiClient } from "@prinpo/stack/query";

const { api, eden, queryClient, ApiProvider } = createApiClient<App>(window.location.origin, {
  prefix: "/api",
});
const options = eden.hello.get.queryOptions({ name: "Stack" });
const key = eden.hello.get.queryKey({ name: "Stack" });
```

The options work with native `useQuery`, `useMutation`, `useInfiniteQuery`, and QueryClient methods. `ApiProvider` supplies the factory's cache through QueryClientProvider. Components and loaders import the same scoped clients, while requests and keys retain the configured prefix. The original low-level factories remain available. The [connector guide](docs/eden-query.md) covers provider setup, Router loaders, keys, filters, and pagination. The fullstack example demonstrates these against real Elysia endpoints.

This connector is adapted from **eden-tanstack-react-query by Ilya Zhidkov and contributors**. Stack maintains its source and pins Query to 5.102.8 alongside Elysia and Eden. All original functions and types are retained for review. See [upstream credit, baseline, and modifications](src/eden-query/README.md) and [third-party notices](src/THIRD_PARTY_NOTICES.md). The upstream material remains Apache-2.0 licensed.

## Optional logging

The [logging guide](docs/logger.md) covers one-call evlog setup, shared plugin registration, typed errors, native Query callbacks, and local CLI commands. Logging is optional even for Elysia applications. Native validation responses remain intact; streaming integration and external services are deferred.

## Serving the browser build

Use standard startup to initialize configuration before importing the Elysia app:

```ts
import { startServer } from "@prinpo/stack/server";

await startServer(() => import("./app"));
```

Stack owns `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=development`, and APP_ENV defaulting to NODE_ENV. App values live in independent `env/server` and `env/client` schemas; Stack derives public dynamic delivery automatically. Use `stack({ api: true })` in Vite to read backend connection settings for proxying and resolve client envs locally. See the [environment guide](docs/env.md) for overrides, startup profiles, and advanced standalone helpers. The lower-level `serveApp` helper remains available for applications managing startup themselves.

`assets` defaults to `dist/client`, relative to the working directory; `apiPrefix` defaults to `/api`. The directory must contain `index.html`. Keep its contents limited to public browser build output. The plugin serves assets and returns the app shell for GET/HEAD browser navigations accepting HTML. Unknown API paths, missing asset paths with file extensions, and non-navigation requests keep their 404 responses.

Stack package distribution checks and browser E2E remain deferred under the [source development milestone](docs/milestones/0002-source-linked-development.md). The example browser/server builds and HTTP startup behavior are validated against source.

## Working on Stack

```sh
bunx --bun vp check
bunx --bun vp test
bunx --bun vp run example:check
```

Library checks run against source. CLI integration tests build disposable applications and exercise production HTTP behavior; installed-package smoke checks verify executable resolution. Compile-only checks exercise Eden's inferred contract through the public exports. Existing tests cover the Vite connection, route generation and watching, and the serving plugin's HTTP behavior. Refresh behavior is verified manually at this stage.

The example uses Vite's native config runner (`--configLoader runner`) to track the Stack preset and its source dependencies. Browser-used Stack modules use Vite's HMR, falling back to a page reload where necessary. Bun's watch mode restarts the backend when its imported source changes; reload the browser manually to fetch updated backend data. Tooling changes restart Vite automatically. Watching follows native dependency tracking with minimal configuration; broader reloads or restarts are a last resort.

Stack maintainers update vulnerable dependencies and publish new Stack versions. Applications can use temporary package-manager overrides while an update is prepared; those versions fall outside the tested dependency set.
