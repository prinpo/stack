# Full-stack foundation

A small application using Stack's public entry points and utilities. Its greeting is loaded through native Eden, and its form sends a typed mutation. Two file routes demonstrate navigation and route generation; router devtools are visible during development.

## Run

From the repository root:

```sh
bunx --bun vp install
bunx --bun vp run example:setup
bunx --bun vp run example:dev
```

Open <http://localhost:5173>. The setup command builds and packs Stack, then installs that artifact here. Re-run setup after changing the library. Example source changes reload directly during development.

From this directory, use `bun run dev` to run both processes, or `bun run dev:server` and `bun run dev:client` in separate terminals. `bun run check` formats, lints, and typechecks the application after dependencies are installed. The generated route tree is committed so checking also works before the first dev-server run.

## Follow the connection

| File                   | Responsibility                                                                  |
| ---------------------- | ------------------------------------------------------------------------------- |
| `vite.config.ts`       | One Stack preset connects React, routing, and `/api` proxying to port 3000.     |
| `src/server/app.ts`    | Defines native Elysia routes and exports the inferred application type.         |
| `src/server/index.ts`  | Starts Bun's backend listener and attaches the serving plugin in production.    |
| `src/client.ts`        | Initializes native Eden using the browser origin and a type-only server import. |
| `src/main.tsx`         | Creates the native router, registers its type, and mounts React.                |
| `src/routes/`          | Defines file routes, loader data, the typed mutation form, and router devtools. |
| `src/routeTree.gen.ts` | Managed by the Router generator.                                                |

The browser sends `/api/hello` and `/api/echo` requests to its own origin. Vite forwards those paths unchanged to Elysia. An API failure retains its HTTP status and response body through the proxy.

To use another layout, set `router.routesDirectory` and `router.generatedRouteTree` in the preset. To use another API namespace, change the Elysia routes, `api.prefix` in the preset, and `apiPrefix` in the serving plugin together. Keep the Eden base URL at the origin.

For a frontend-only application, omit the server files, API client, and `api` preset option. A backend-only application can use the server and Eden entry points with Bun alone.

## Production wiring

`bun run build` invokes Vite+ to create `dist/`. `bun run start` attaches `serveApp()` and runs Elysia on port 3000, serving that directory and the API on one origin. Production application builds and end-to-end testing are deferred for this milestone; these commands document the intended wiring.
