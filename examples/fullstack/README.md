# Full-stack foundation

A small application using Stack's public entry points and utilities. Its Router loader prefetches a greeting into TanStack Query, the form sends a typed Eden mutation, and a cursor endpoint demonstrates infinite queries. Two file routes demonstrate navigation and route generation; router devtools are visible during development.

## Run

From the repository root:

```sh
bunx --bun vp install
bunx --bun vp run example:dev
```

Open <http://localhost:5173>. This example is a private Bun workspace. Its `file:../..` dependency links to the root `@prinpo/stack` package, whose public exports point into `src/`. Both application and Stack imports resolve to live TypeScript source through the same public `@prinpo/stack/...` paths. No library build or artifact setup is needed.

The root install uses Bun's hoisted linker. Keep shared tooling versions aligned with the root manifest so dependencies stay in the root `node_modules`; Vite's cache also lives there.

From this directory, use `bun run dev` to run both processes, or `bun run dev:server` and `bun run dev:client` in separate terminals. `bun run check` formats, lints, and typechecks the application after dependencies are installed. The generated route tree is committed so checking also works before the first dev-server run.

Vite updates browser-used Stack modules through HMR or a page reload. The client script uses `--configLoader runner` so changes to Stack's Vite preset and its helpers also restart Vite through native config dependency tracking. Bun's `--watch` mode restarts the backend when its imported application or Stack modules change. Reload the page manually when you want to fetch updated backend responses. Unused blocks do not need to trigger updates.

## Follow the connection

| File                   | Responsibility                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `vite.config.ts`       | One Stack preset connects React, routing, and `/api` proxying to port 3000.                     |
| `src/server/app.ts`    | Defines native Elysia routes and exports the inferred application type.                         |
| `src/server/index.ts`  | Starts Bun's backend listener and attaches the serving plugin in production.                    |
| `src/client.ts`        | Creates the scoped API clients, Query cache, and Query provider.                                |
| `src/main.tsx`         | Loads public runtime configuration before importing the application; offers retry on failure.   |
| `src/application.tsx`  | Creates the native router, registers its type, and mounts React.                                |
| `env/`                 | Separate client/server schemas with selected shared public definitions.                         |
| `src/routes/`          | Defines routes, the Query provider, query prefetching, mutation form, pagination, and devtools. |
| `src/routeTree.gen.ts` | Managed by the Router generator.                                                                |

The browser sends `/api/hello`, `/api/echo`, and `/api/messages` requests to its own origin. Vite forwards those paths unchanged to Elysia. The connector throws Eden's error envelope for Query to handle while native Treaty remains available as `api`. The **Refresh greeting** button invalidates the generated query key; **Send message** runs a mutation; **Load more** requests the next cursor page. All six messages are loaded after two additional pages.

`createApiClient<App>(origin, { prefix: "/api" })` creates the clients, cache, and ApiProvider in one call. Components and loaders import the same singleton clients. ApiProvider supplies QueryClientProvider around the root route so the existing Router renderer remains reusable without Query. The loader uses `queryClient.query({ ...options, staleTime: "static" })` with the standalone `eden` proxy and the same QueryClient used by component hooks. Routes are accessed as `eden.hello.get`, while requests and cache keys retain the `/api` prefix. See the [connector guide](../../docs/eden-query.md) and [upstream attribution](../../src/eden-query/README.md).

To use another layout, set `router.routesDirectory` and `router.generatedRouteTree` in the preset. To use another API namespace, change the Elysia routes, `api.prefix` in the preset, and `apiPrefix` in the serving plugin together. Keep the Eden base URL at the origin.

For a frontend-only application, omit the server files, API client, and `api` preset option. A backend-only application can use the server and Eden entry points with Bun alone.

## Optional logging and structured errors

The example opts into evlog through shared `src/server/logging.ts`, registered on the main app and `src/server/errors.ts` route module. **Try a structured API error** calls a typed 409 endpoint. The same guard runs in a native `MutationCache` callback and the endpoint's mutation `onError`, retaining `orderId` inference. Native validation and ordinary statuses remain available.

From the repository root, use `bunx --bun vp run example:logs`, `example:logs:errors`, or `example:logs:json`. Files default to this example's `.evlog/logs`; set `PRINPO_LOG_DIR` to share another directory between server and commands. Runtime logging needs no external account. Scripts use the root's pinned CLI and disable CLI usage telemetry. See [the logging guide](../../docs/logger.md) for options and type boundaries.

## Production wiring

`bun run build` validates static inputs and builds the browser in `dist/` and Bun server in `dist/server/`, without requiring `PUBLIC_DEPLOYMENT_NAME` or deployment credentials. Start the same artifacts with `PUBLIC_DEPLOYMENT_NAME=staging bun run start` or `PUBLIC_DEPLOYMENT_NAME=production bun run start`. Production Elysia serves the browser build and API from one origin. Configure `PORT` when needed; it defaults to 3000.

The default schema path belongs to the browser. The server script explicitly selects `env/server` through native `varlock run`; Stack's auto-load import retains that validated graph. `env/client` includes fixed `APP_TITLE` metadata, while shared `PUBLIC_DEPLOYMENT_NAME` is resolved at startup and delivered through `/api/public-env`. The development server script supplies `local`. Both Bun configurations disable native dotenv loading. `bun run env:types` regenerates the committed local types; generated files are excluded from formatting and linting.

Restart the whole `varlock run` command after changing runtime values. Bun's inner code watcher does not resolve a new configuration snapshot. Native redaction and response scanning are disabled; applications own secret-handling discipline. See [the environment guide](../../docs/env.md) for schema rules, the two required pinned Bun patches, optional provider setup, and separate-origin bootstrap considerations.

This milestone verifies browser and backend builds to establish reusable artifacts. Stack package builds/distribution and automated browser E2E remain deferred. The backend artifact keeps package imports external, so deployment still needs the source-linked Stack package, its pinned dependencies, schemas, and installed root patches; it is not a standalone binary or a qualified published-package deployment.
