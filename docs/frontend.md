---
title: Frontend Block
description: Configure React, file-based TanStack Router routes, browser mounting, and Stack's Vite integration.
type: reference
topics:
  - frontend
  - react
  - router
  - vite
related:
  title: Related
  links:
    - application-patterns.md
    - eden-query.md
    - env.md
    - development.md
    - production.md
---

# Frontend Block

Use `@prinpo/stack/react` for native TanStack Router APIs and Stack's browser mounting helper, `@prinpo/stack/devtools` for native router devtools, and `@prinpo/stack/vite` for the build integration. Import React APIs from `react`; React and React DOM are application-owned peers. See [application configuration](application-patterns.md) for the compatible dependency and TypeScript setup.

## Vite configuration

Keep `vite.config.ts` at the application root:

```ts
import { stack } from "@prinpo/stack/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [stack({ api: true })],
  server: { port: 5173, strictPort: true },
});
```

`stack()` combines React tooling, file-route generation, route code splitting, React/React DOM deduplication, environment integration, and development browser logging. Add this preset once. Omit `api` for a frontend-only app; database, Query, and auth are separately selected capabilities.

`StackOptions` exposes:

| Option               | Behavior                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api: true`          | Resolve the development backend target from Stack's server environment; default namespace `/api`. Wildcard listen hosts connect through loopback. |
| `api: { target }`    | Proxy to an explicit backend origin, skipping managed target resolution.                                                                          |
| `api: { prefix }`    | Reserve and proxy that API namespace; the request path is forwarded unchanged. Keep server routes and production serving aligned.                 |
| `api: { serverEnv }` | Select a custom server schema directory when resolving the managed development target.                                                            |
| `router`             | Native TanStack Router plugin configuration except `target`, which Stack fixes to React. Automatic code splitting defaults to enabled.            |
| `react`              | Native `@vitejs/plugin-react` options.                                                                                                            |

The preset uses `src/` as Vite's root, with these defaults:

| Input or output        | Default                | Resolution                                                    |
| ---------------------- | ---------------------- | ------------------------------------------------------------- |
| HTML entry             | `src/index.html`       | Required browser entry convention.                            |
| Public assets          | `src/public/`          | Application-relative `publicDir`; `false` disables it.        |
| Routes                 | `src/routes/`          | Application-relative `router.routesDirectory`.                |
| Generated route tree   | `src/routeTree.gen.ts` | Application-relative `router.generatedRouteTree`.             |
| Router temporary files | `.tanstack/tmp`        | Application-relative `router.tmpDir`.                         |
| Vite cache             | `node_modules/.vite`   | Application-relative `cacheDir`.                              |
| Browser output         | `dist/client/`         | Application-relative `build.outDir`; cleared before building. |

Native Vite options remain available. Keep `dist/client/` for the standard Stack CLI production lifecycle; lower-level custom deployments own any alternate output layout. Environment schema discovery remains application-relative despite Vite's `src/` root. Read [environment guidance](env.md) before adding browser configuration; the preset already installs Stack's environment plugin.

## Browser entry and mounting

`src/index.html` must contain `#root` for the mounting helper. Its module URL is `/main.tsx`, since Vite's root is already `src/`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Application</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx` connects the generated tree to the native Router:

```tsx
import { createRootAndRender, createRouter } from "@prinpo/stack/react";

import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRootAndRender(router);
```

`createRootAndRender(router)` finds `#root`, creates the React root, and renders `RouterProvider` inside `StrictMode`. A missing element throws `Missing application root`. Use it for the standard mount; custom host integration can compose native Router and React DOM APIs directly. The module augmentation uses TanStack Router's original module name because that is where its `Register` interface is declared.

## Routes and application providers

Keep route files small. They declare navigation, loaders, and layouts; feature modules own the UI. The preset generates the route tree during development and build. Treat that tree as generated output.

A root route without Query can render `Outlet` directly. With `createApiClient`, place its provider around routed content in `src/routes/__root.tsx`:

```tsx
import { TanStackRouterDevtools } from "@prinpo/stack/devtools";
import { Outlet, createRootRoute } from "@prinpo/stack/react";

import { ApiProvider } from "../client";

export const Route = createRootRoute({ component: Layout });

function Layout() {
  return (
    <ApiProvider>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </ApiProvider>
  );
}
```

A feature route such as `src/routes/about.tsx`:

```tsx
import { createFileRoute } from "@prinpo/stack/react";

import { About } from "../features/about/view";

export const Route = createFileRoute("/about")({ component: About });
```

Use native `Link`, route parameters, search validation, `beforeLoad`, loaders, and error boundaries through `@prinpo/stack/react`. [Eden Query](eden-query.md) explains how loaders and components share typed request options and a single Query cache. Authenticated browser navigation complements server authorization; see [auth](auth.md).

## Native APIs and limits

All TanStack Router exports are forwarded by `@prinpo/stack/react`; all TanStack Router devtools exports are forwarded by `@prinpo/stack/devtools`. Use the [TanStack Router documentation](https://tanstack.com/router/latest/docs/overview) for native router behavior and the [Vite+ guide](https://viteplus.dev/guide/) for application tooling. Stack adds the mounting helper and integration defaults above. Stack's documented lifecycle serves a client-rendered SPA; SSR is outside this scope.
