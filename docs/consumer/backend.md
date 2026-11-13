---
title: Backend and typed API client
description: Compose Elysia routes, preserve inferred Eden contracts, and select Stack's standard or lower-level server lifecycle.
type: reference
topics:
  - backend
  - elysia
  - eden
  - startup
  - shutdown
related:
  title: Related
  links:
    - application-patterns.md
    - eden-query.md
    - env.md
    - logger.md
    - auth.md
    - production.md
---

# Backend and typed API client

Use `@prinpo/stack/server` for native Elysia exports and Stack lifecycle helpers. Use `@prinpo/stack/client` for native Eden exports when a raw typed client is sufficient, or [Eden Query](eden-query.md) for typed Query integration. Browser code imports the application's server contract with `import type`.

## Route composition and the inferred contract

Keep application assembly separate from the listening entry. For example, `src/server/routes/greeting.ts` owns a small native Elysia app:

```ts
import { Elysia, t } from "@prinpo/stack/server";

export const greetingRoutes = new Elysia().get(
  "/api/hello",
  ({ query }) => ({ message: `Hello, ${query.name}!` }),
  { query: t.Object({ name: t.String({ minLength: 1 }) }) },
);
```

Compose it in `src/server/app.ts` and export the inferred type:

```ts
import { Elysia } from "@prinpo/stack/server";

import { greetingRoutes } from "./routes/greeting";

export const app = new Elysia().use(greetingRoutes);
export type App = typeof app;
```

Keep the fluent Elysia chain inferred, including route return types. A broad annotation such as `const app: Elysia = ...` loses the route contract Eden needs. Put reusable plugins and schemas in their own modules; application rules and authorization remain application-owned. Use native Elysia `t` schemas for HTTP contracts or schema-derived validation from the [Database Block](database.md) when the input comes from a persisted model.

For expected structured failures, use the logging integration's `apiError` in the route return expression so Eden sees the error branch; see [logging and typed failures](logger.md). Mount the [auth helpers](auth.md) for auth endpoints and protected routes rather than rebuilding session/cookie handling.

## Standard startup

The standard CLI detects a backend at `src/server/index.ts`. This entry should defer importing the application:

```ts
import { startServer } from "@prinpo/stack/server";

await startServer(() => import("./app"));
```

`startServer(loadApplication, options?)` returns the listening Elysia app. Its application loader must resolve to `{ app }`. Startup:

- Validates Stack-owned and application environment settings before importing application modules.
- Runs managed database migrations in production before application import.
- Imports the application and, in production with a client enabled, attaches built SPA serving and public runtime environment injection.
- Awaits registered Elysia modules and validates registered auth integrations before listening.
- Listens using environment-derived `HOST` and `PORT`, and installs shutdown handling for SIGINT/SIGTERM.

This order lets database/auth modules use validated environment accessors at module scope. Preserve the deferred import instead of statically importing `app` into the listening entry.

`StartServerOptions` contains:

| Option               | Default and use                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `env.server`         | `env/server`; select a custom server schema directory.                                                                        |
| `env.client`         | `env/client`; set `false` for an explicitly backend-only host.                                                                |
| `assets`             | `dist/client`; built browser directory for production serving.                                                                |
| `apiPrefix`          | `/api`; reserved API namespace whose misses stay 404s.                                                                        |
| `transformIndexHtml` | Optional async/sync HTML transformation before Stack injects public runtime configuration. Applied once at startup.           |
| `onStop(status)`     | Replaces the default `app.stop()` action on SIGINT/SIGTERM; explicitly stop the app and close application-owned clients here. |

For direct backend-only use:

```ts
await startServer(() => import("./app"), { env: { client: false } });
```

An installed Stack CLI also selects backend-only serving from detected capabilities. Lower-level callers should select `client: false` explicitly if they have no browser build.

## Shutdown and resource ownership

An application's database client, queues, and other connections need application-owned cleanup. An Elysia `onStop` hook is suitable when resource lifetime matches the app. When overriding Stack's signal action, stop the HTTP app as well:

```ts
import { startServer } from "@prinpo/stack/server";

const app = await startServer(() => import("./app"), {
  onStop: async () => {
    try {
      await app.stop();
    } finally {
      const { client } = await import("./database");
      await client.close();
    }
  },
});
```

Here `./database` is the application's module exporting its client. Stack guards against repeated signal cleanup, sets exit status 130 for SIGINT and 143 for SIGTERM, and removes its handlers after stopping. A failed cleanup reports the error, sets status 1, and attempts to stop the app. Calling `app.stop()` directly also removes Stack's signal handlers; custom signal cleanup runs only for Stack's signal path.

## Raw typed Eden client

For code that needs native requests without a Query cache:

```ts
import { treaty } from "@prinpo/stack/client";

import type { App } from "./server/app";

const api = treaty<App>(window.location.origin);
const result = await api.api.hello.get({ query: { name: "Stack" } });
if (result.error) {
  console.error(result.error.status, result.error.value);
} else {
  console.info(result.data.message);
}
```

The first `api` is the client variable and the second is the literal `/api` route segment. Native Treaty retains all segments. The Query factory's optional `prefix` shortens client access while preserving URLs and keys. Use same-origin URLs by default; a separate deployment needs an explicit backend origin and application-owned cross-origin/cookie configuration. Read [native Treaty documentation](https://elysiajs.com/eden/treaty/overview) for request options, headers, responses, and non-Query usage.

## Lower-level serving helpers

Prefer `startServer` with the standard CLI for the integrated lifecycle. Other exported helpers support deliberately custom hosts:

| Helper                                                                             | Contract                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serveApp(app, { isProduction, port?, assets?, apiPrefix?, transformIndexHtml? })` | Attaches built SPA serving only when `isProduction` is true, then calls `app.listen(port)` with default port 3000. It returns no app or server.                                              |
| `startFrontend()`                                                                  | Starts Stack's built frontend-only Bun server from `dist/client`, resolves startup public configuration, and returns the Bun server. The CLI selects this for frontend-only production apps. |
| `ServeAppOptions`                                                                  | Public type for `assets`, `apiPrefix`, and `transformIndexHtml`. The `serveApp` call additionally requires `isProduction` and accepts `port`.                                                |

`serveApp` is intentionally lower-level: the caller owns environment loading, migrations, auth validation, runtime configuration injection, and shutdown. `startFrontend` performs its own production startup configuration and managed database migration when enabled; it serves GET/HEAD, public files, and SPA navigation while preserving API and missing-asset 404s. See [production lifecycle](production.md) for build artifacts and deployment requirements.

All other exports from `@prinpo/stack/server` preserve Elysia's native APIs, including the default Elysia export. Consult [Elysia routing](https://elysiajs.com/essential/route) for native request/lifecycle behavior.
