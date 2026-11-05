# Full-stack foundation

A runnable environment sandbox using Stack's public entry points. The landing page displays public static and dynamic browser configuration and fetches four server demo values on demand. The `/queries` route retains the Query, mutation, and pagination examples; `/about` explains the wiring.

## Run

From the repository root:

```sh
bun install --frozen-lockfile
bun run stack dev
```

Open <http://localhost:5173>. This example is a private Bun workspace. Its `file:../..` dependency links to the root `@prinpo/stack` package, whose public exports point into `src/`. Both application and Stack imports resolve to live TypeScript source through the same public `@prinpo/stack/...` paths. No library build or artifact setup is needed.

Vite+ is installed locally; a global `vp` installation is optional. Prefer `bun --bun vp` for direct tooling commands. The root install uses Bun's hoisted linker. Keep shared tooling versions aligned with the root manifest so dependencies stay in the root `node_modules`; Vite's cache also lives there.

From this directory, use `bun run stack dev` to run both processes, or `bun run stack doctor` to inspect the application. The `stack` script points to the live source executable because Bun does not link the root package's own binary in this source-linked workspace; installed applications use the package's local `stack` executable directly. `bun run check` formats, lints, and typechecks the application after dependencies are installed. The generated route tree is committed so checking also works before the first dev-server run.

Vite updates browser-used Stack modules through HMR or a page reload. The client script uses `--configLoader runner` so changes to Stack's Vite preset and its helpers also restart Vite through native config dependency tracking. Bun's `--watch` mode restarts the backend when its imported application or Stack modules change. Reload the page manually when you want to fetch updated backend responses. Unused blocks do not need to trigger updates.

## Follow the connection

| File                   | Responsibility                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `vite.config.ts`       | One preset connects React, routing, env delivery, and proxying using backend connection settings.     |
| `src/server/app.ts`    | Defines native Elysia routes and exports the inferred application type.                               |
| `src/server/index.ts`  | Initializes configuration before importing the app, then starts the backend and production serving.   |
| `src/client.ts`        | Creates the scoped API clients, Query cache, and Query provider.                                      |
| `src/main.tsx`         | Creates the native router, registers its type, and mounts React with configuration already available. |
| `env/`                 | Client/server schemas with values alongside each schema.                                              |
| `src/routes/`          | Defines routes, the Query provider, query prefetching, mutation form, pagination, and devtools.       |
| `src/routeTree.gen.ts` | Managed by the Router generator.                                                                      |

On `/queries`, the browser sends `/api/hello`, `/api/echo`, and `/api/messages` requests to its own origin. Vite forwards those paths unchanged to Elysia. The connector throws Eden's error envelope for Query to handle while native Treaty remains available as `api`. The **Refresh greeting** button invalidates the generated query key; **Send message** runs a mutation; **Load more** requests the next cursor page. All six messages are loaded after two additional pages.

`createApiClient<App>(origin, { prefix: "/api" })` creates the clients, cache, and ApiProvider in one call. Components and loaders import the same singleton clients. ApiProvider supplies QueryClientProvider around the root route so the existing Router renderer remains reusable without Query. The loader uses `queryClient.query({ ...options, staleTime: "static" })` with the standalone `eden` proxy and the same QueryClient used by component hooks. Routes are accessed as `eden.hello.get`, while requests and cache keys retain the `/api` prefix. See the [connector guide](../../docs/eden-query.md) and [upstream attribution](../../src/eden-query/README.md).

To use another layout, set `router.routesDirectory` and `router.generatedRouteTree` in the preset. To use another API namespace, change the Elysia routes, `api.prefix` in the preset, and `apiPrefix` in the serving plugin together. Keep the Eden base URL at the origin.

For a frontend-only application, omit the server files, API client, and `api` preset option. A backend-only application can use the server and Eden entry points with Bun alone.

## Optional logging and structured errors

The example opts into evlog through shared `src/server/logging.ts`, registered on the main app and `src/server/errors.ts` route module. **Try a structured API error** calls a typed 409 endpoint. The same guard runs in a native `MutationCache` callback and the endpoint's mutation `onError`, retaining `orderId` inference. Native validation and ordinary statuses remain available.

From the repository root, use `bun run stack logs`, `bun run stack logs errors`, or `bun run stack logs --json`. Files default to this example's `.evlog/logs`; set `LOG_DIR` to share another directory between server and commands. Runtime logging needs no external account. The CLI owns its tested evlog version and disables usage telemetry. See [the logging guide](../../docs/logger.md) for options and type boundaries.

## Environment files

Run `bun run stack dev`, or `bun run stack build` followed by `bun run stack start`, without supplying application environment variables in the command.

The example commits public configuration and explicitly fake secret-classified strings:

- `env/client/.env` contains `CLIENT_PUBLIC_STATIC`, fixed in the browser build.
- `env/client/.env.development` and `.env.production` contain `CLIENT_PUBLIC_DYNAMIC` with distinct development and production values.
- `env/server/.env.development` and `.env.production` contain `SERVER_PUBLIC_DYNAMIC`, `SERVER_SECRET_DYNAMIC`, with different development and production values.
- `env/server/.env` contains `SERVER_PUBLIC_STATIC` and the dummy `SERVER_SECRET_STATIC`.
- Stack owns NODE_ENV and APP_ENV alongside HOST/PORT. Dev selects development; build/start select production. `bun run stack start --env staging` selects staging configuration while retaining production runtime behavior.

Schemas describe types, exposure, and timing. Each setting is declared and assigned in the same directory: browser configuration in `client/`, backend configuration and credentials in `server/`. Vite loads client values directly during development, using the selected profile; production startup loads the two directories independently. It derives the client dynamic keys from the client schema and delivers their validated values through HTML injection. The schemas do not import each other, and app code maintains no exposure key lists. The client schema supports both static and dynamic public values; credentials never belong there. Browser static values require a production rebuild. Development client dynamic values update on page reload; production client dynamics and backend values require a server restart. The Bun server reads all four server demo values at startup; its static classification adds build validation without embedding server values in the browser.

Each directory has a `.env.example`. Copy `env/client/.env.example` to `env/client/.env.development.local` for public browser overrides. Copy `env/server/.env.example` to `env/server/.env.development.local` for personal backend settings and credentials. For a real integration, declare its credentials in the server schema and put their values only in that local file. For example:

```dotenv
# env/server/.env.schema (declaration, committed)
# @optional @type=string
OPENAI_API_KEY=
```

```dotenv
# env/server/.env.development.local (values, ignored)
OPENAI_API_KEY=your-personal-key
```

For production, put public browser overrides in `env/client/.env.production.local` and backend settings/credentials in `env/server/.env.production.local`. Create them on the host or mount them at those locations relative to the example directory inside the container. With Coolify or Docker, keep the production command as `bun run stack start` and supply these runtime files through deployment file mounts. Keep local files out of image build contexts; they are not part of the committed example.

Varlock's precedence, from lowest to highest, is schema defaults → `.env` → `.env.local` → `.env.<mode>` → `.env.<mode>.local` → process environment. Use the mode-specific local files for credentials: `.env.local` applies to both modes, and committed mode values override it. A production start never loads `.env.development.local`. The example has narrow Git exceptions for its public files; all local overrides remain ignored. See [Varlock's environment rules](https://varlock.dev/guides/environments/).

## Try the environment sandbox

Open `/` and compare `CLIENT_PUBLIC_STATIC` with `CLIENT_PUBLIC_DYNAMIC`. Click **Fetch server envs** to call `/api/env`, which returns exactly `SERVER_PUBLIC_STATIC`, `SERVER_PUBLIC_DYNAMIC`, `SERVER_SECRET_STATIC`, and `SERVER_SECRET_DYNAMIC` with `Cache-Control: no-store`.

The `SERVER_SECRET_*` values are long dummy strings for teaching sensitivity and timing. This endpoint deliberately returns them, because this example contains no real credentials. It does not serialize the whole server environment. Real secrets must never be assigned to these demo variables or added to this response. Secret classification alone does not prevent application code from returning a value; automatic response scanning is disabled in this example.

1. Run `bun run stack dev`. Edit the static client value in `env/client/.env`; Vite reloads the browser configuration. Change client dynamic values in `env/client/.env.development` and reload the page. For backend values in `env/server/.env.development`, the CLI restarts both processes automatically; fetch again once they are ready.
2. Run `bun run stack build`, then `bun run stack start`. The browser static value comes from the build; dynamic values now come from each directory's `.env.production` profile. Server static values come from `env/server/.env` at startup.
3. Stop the server, change `CLIENT_PUBLIC_DYNAMIC` in `env/client/.env.production.local` and the server dynamic values in `env/server/.env.production.local`, then run `bun run stack start` again **without rebuilding**. Reload and fetch to see the changed values.
4. Change `CLIENT_PUBLIC_STATIC` and restart without rebuilding: the browser still displays the built value. Rebuild and restart to update it. For server static values, startup reads the current file value; this example's Bun build does not inline server `ENV` reads. Static server values must still pass validation during builds.

Fetches read the server's startup snapshot; they do not reload `.env` files. Each directory has a `.env.example` for creating ignored local overrides.

## Production wiring

`bun run stack build` validates static inputs and builds the browser in `dist/client/` and Bun server in `dist/server/`, publishing `dist/manifest.json` only on success, without requiring deployment overrides or real credentials. Start with `bun run stack start`; it loads the committed production profile and any host-local production overrides. Change `CLIENT_PUBLIC_DYNAMIC` in `env/client/.env.production.local` to reuse the same artifacts for another deployment. Production Elysia serves the browser build and API from one origin. Stack owns `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=development`, and APP_ENV defaulting to NODE_ENV; override them in server files without redeclaring validation. For container access through published ports, set `HOST=0.0.0.0` in the production server file. Vite derives only the API proxy target from those connection settings; it resolves client envs locally.

The server entry calls `startServer(() => import("./app"))`: configuration initializes before application modules read `ENV`, and production startup prepares HTML with client configuration. No environment-fetch endpoint is registered. CLI development watches the entry; production startup reads the successful build manifest and hands off to Bun without an ongoing CLI parent. Stack reuses that validated server snapshot without resolving providers twice. `stack({ api: true })` handles the browser's native Varlock plugin, proxy, and local client-env resolution with no repeated addresses or ports. Browser `main.tsx` is identical in both modes. Both Bun configurations disable native dotenv loading. `bun run stack env codegen` regenerates the committed local types; generated files are excluded from formatting and linting.

Backend runtime-file and connection-setting edits restart both development processes. Restart manually for external imports or newly created schema directories. Client dynamic file changes take effect on reload. Development runs the loader inside Bun, so code-triggered process restarts also resolve a fresh snapshot. Production resolves a startup snapshot: restart `bun run stack start` after changing its values. Native redaction and response scanning are disabled; applications own secret-handling discipline. See [the environment guide](../../docs/env.md) for schema rules, the required Varlock core patch, optional provider setup, and separate-origin bootstrap considerations.

This milestone verifies browser and backend builds to establish reusable artifacts. Stack package builds/distribution and automated browser E2E remain deferred. The backend artifact keeps package imports external, so deployment still needs the source-linked Stack package, its pinned dependencies, schemas, and the installed root patch; it is not a standalone binary or a qualified published-package deployment.
