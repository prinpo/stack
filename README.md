# @prinpo/stack

A thin application framework for Bun, Elysia, Eden, and TanStack Router. Stack owns a tested set of library versions and connects their native APIs through a few utilities.

The first milestone includes file-based routing, router devtools, a Vite preset, a development API proxy, and an Elysia serving plugin. Query, database, auth, logging, and environment integrations follow separately. See the [milestone boundary](docs/milestones/0001-fullstack-foundation.md) and [architectural decisions](docs/adr/).

## Try the full-stack example

From the repository root:

```sh
bunx --bun vp install
bunx --bun vp run example:setup
bunx --bun vp run example:dev
```

Open <http://localhost:5173>. Elysia runs on port 3000. The example uses an installed package artifact, so it exercises the public exports and declarations. Run `example:setup` again after changing Stack to rebuild and reinstall that artifact.

The [full-stack example](examples/fullstack/README.md) documents its files and development workflow. `examples/` is a place to try real scenarios and evaluate the DX.

## Public imports

| Import                   | Provides                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `@prinpo/stack/server`   | Native Elysia exports, including its default export, and `serveApp` |
| `@prinpo/stack/client`   | Native Eden exports, including `treaty`                             |
| `@prinpo/stack/react`    | Native TanStack Router exports                                      |
| `@prinpo/stack/devtools` | Native router devtools exports                                      |
| `@prinpo/stack/vite`     | The `stack` Vite preset                                             |

Import React and React DOM from their upstream packages. They are optional peers; UI applications install compatible versions themselves. Other integrated libraries are pinned regular dependencies. Backend entry points can run without React installed. Frontend-only applications still install the shared dependency set and omit the backend configuration.

Vite+ is application development tooling. The example's [package.json](examples/fullstack/package.json) shows the tested versions, Vite alias, and explicit Bun package-manager setting.

## Browser tooling

```ts
import { defineConfig } from "vite-plus";
import { stack } from "@prinpo/stack/vite";

export default defineConfig({
  plugins: [stack({ api: { target: "http://localhost:3000" } })],
});
```

The preset configures React, file-route generation, automatic route splitting, shared React resolution, and the optional API proxy. By default, requests under `/api` keep their paths when forwarded to Elysia. `/apiary` remains a frontend path. Proxying preserves the browser's origin.

For a frontend-only application, use `stack()`. Configure `router.routesDirectory` and `router.generatedRouteTree` for a different layout, or pass other native Router plugin options through `router`. React plugin options go through `react`. A custom proxy namespace uses `api.prefix`, for example `/rpc`.

Router's `Register` and generated `FileRoutesByPath` declarations augment the native `@tanstack/react-router` module. Keep that native type-registration target even though application imports use Stack; the [example entry point](examples/fullstack/src/main.tsx) demonstrates it. Exclude the generated route tree from formatting and linting, as the [example config](examples/fullstack/vite.config.ts) does.

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

## Serving the browser build

Attach the opt-in plugin to an ordinary Elysia instance:

```ts
import { serveApp } from "@prinpo/stack/server";
import { app } from "./app";

if (process.env.NODE_ENV === "production") {
  app.use(serveApp({ assets: "dist", apiPrefix: "/api" }));
}

app.listen(3000);
```

`assets` defaults to `dist`, relative to the working directory; `apiPrefix` defaults to `/api`. The directory must contain `index.html`. Keep its contents limited to public browser build output. The plugin serves assets and returns the app shell for GET/HEAD browser navigations accepting HTML. Unknown API paths, missing asset paths with file extensions, and non-navigation requests keep their 404 responses.

Production application build verification and end-to-end testing are deferred in this milestone.

## Working on Stack

```sh
bunx --bun vp run build
bunx --bun vp check
bunx --bun vp test
bunx --bun vp run check:package
bunx --bun vp run example:setup
bunx --bun vp run example:check
```

Build before checking or testing: the compile-only contract checks use the built public entry points. The package check installs an artifact in a temporary consumer, verifies backend use without React, then checks browser-safe imports. Focused tests cover the Vite connection, route generation and watching, and the serving plugin's HTTP behavior.

Stack maintainers update vulnerable dependencies and publish new Stack versions. Applications can use temporary package-manager overrides while an update is prepared; those versions fall outside the tested dependency set.
