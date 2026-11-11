# Use Vite+ and Bun with a single public origin

Use Vite for browser development and builds, run through Vite+ with `bun --bun vp ...`, and Bun to run Elysia. Install dependencies through Bun and prefer the pinned project-local Vite+ executable; a global `vp` installation is optional. This keeps contributors from needing a second globally managed tool. Vite+ is the documented application toolchain, not a runtime dependency of Stack; tooling helpers may require it when that reduces integration code. A separate plain-Vite workflow is not required. Prefer TanStack Router's file-based routing while preserving its native support for code-based routes and configurable application layout.

The default full-stack setup exposes the frontend and API through one public origin, with API endpoints under `/api`. During development, Vite proxies API requests to Elysia; in production, Elysia serves the built browser application and API. Separate frontend and backend deployments remain possible through explicit client configuration.

Provide one plugin preset through `@prinpo/stack/vite` that combines React tooling, file-route generation, and optional API proxy configuration. Applications retain a native Vite+ configuration and can configure their route locations and API target. Omitting the API proxy supports frontend-only applications. Application-owned scripts start the Vite+ browser process and the Bun backend process, with a convenience script to run both.

Provide an opt-in Elysia plugin through `@prinpo/stack/server` that serves the browser build and handles SPA deep links. Keep the asset directory and API prefix configurable. SPA fallback must preserve API misses as 404 responses rather than returning the application shell.

The browser uses native Eden Treaty initialization with the server's inferred application type imported through `import type`. Use the browser's origin for the default same-origin setup and an explicit origin for separate deployments.

The development proxy is an agreed default subject to practical verification: previous projects encountered proxy issues, so its stability and development responsiveness must be checked before considering the initial integration complete. Production application build verification and end-to-end testing are deferred beyond this milestone.
