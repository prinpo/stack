---
title: Development tooling and services
description: Understand Stack's managed frontend/backend development session, Vite tooling, environment restarts, Compose dependencies, and development diagnostics.
type: reference
topics: [development, vite, compose, browser-logs, watching]
related:
  title: Related
  links: [cli.md, frontend.md, backend.md, env.md, logger.md, application-patterns.md]
---

# Development tooling and services

Use `bunx --no-install stack dev` from the application root to run detected capabilities as one development session. `src/index.html` enables the frontend and `src/server/index.ts` enables the backend. `src/server/worker.ts` enables a dedicated jobs worker. Each entry can run on its own. See [application patterns](application-patterns.md) for configuration and layout, and [CLI diagnosis](cli.md) for checking detection.

## Toolchain and public origin

Install Bun and application-local Vite+ tooling. Run direct Vite+ commands with `bun --bun vp <command>`; a global installation is optional. Stack's CLI resolves the installed frontend tool and runs delegated JavaScript tools on Bun. `bun --bun vp dev` starts Vite directly; the Stack CLI manages the combined application lifecycle.

The [Stack Vite preset](frontend.md) combines React, file-route generation, optional public-client environment delivery, and optional API proxying. With `stack({ api: true })`, the browser uses its own origin for `/api`, and Vite forwards those requests to the backend. Stack reads only connection settings and dependencies from the server schema to derive that target; unrelated credential resolvers do not run. Wildcard backend binds map to loopback for proxy connections.

File-route generation owns generated route output. Keep generated files out of formatting/linting and modify route source instead. Configuration remains native Vite+ configuration at the application root. Public files live under `src/public/`; HTML at `src/index.html` references `/main.tsx` because `src/` is Vite's root.

## Watching and session ownership

A worker-only application uses `stack dev` for watched development. With HTTP and worker entries, `stack dev` runs the backend in producer-only mode and starts the worker entry in its own process. Edits under `src/server/` and changes to shared files imported by either entry under `src/` drain and restart the managed backend and worker. Vite handles browser-only edits. Compose stays available throughout the reload.

In applications without a worker entry, Stack launches Vite+ for browser development and Bun's code watcher for the backend. Frontend/backend output has distinct labels, including stderr, and screen clearing is disabled. Native tool colors are preserved in terminals. `NO_COLOR` disables colors; `FORCE_COLOR` can force them.

An unexpected child exit stops its siblings and fails the session. Ctrl+C stops application processes, then managed Compose services. Use one managed development session for an application rather than starting conflicting copies on the same ports.

| Change                                                               | Development behavior                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Browser source/routes                                                | Native Vite/React/router tooling handles updates                                                           |
| Backend imports/source                                               | Stack drains HTTP and worker on source edits when a worker entry exists. Otherwise Bun reloads the backend |
| Files under an existing `env/server/` with a backend or worker entry | Stack restarts every detected application process with refreshed settings                                  |
| Client schema sources                                                | Vite tracks schema configuration dependencies; dynamic client values are read when HTML is prepared        |
| Newly created schema directories or external server-schema imports   | Restart `stack dev` manually                                                                               |
| `docker-compose.dev.yml`                                             | Restart `stack dev` manually                                                                               |

Compose dependencies stay running while application processes restart. Stack does not provide general infrastructure reconfiguration or recovery after readiness succeeds.

Managed backend termination and server-environment restarts allow `JOBS_SHUTDOWN_TIMEOUT_MS` plus 2,500 milliseconds of connection-cleanup time before forcing the process group to exit. The CLI resolves only that setting to select the budget, leaving unrelated credentials to backend startup. Worker-enabled projects use the same graceful shutdown on source edits. Restart the session manually for changes to worker dependencies outside the application source tree. See [jobs lifecycle](jobs.md#standalone-runtime-and-shutdown).

## Preview a local build

From the application root, run `stack build` followed by `stack preview` to serve the built application locally. In the Stack repository, use `bun run stack build` and `bun run stack preview` for the fullstack example. Open <http://localhost:3000> for the app or <http://localhost:8025> for its Mailpit inbox. Preview uses `NODE_ENV=production` and defaults to the `development` Varlock profile. Use `stack preview --env preview` for an application-owned preview profile. The built HTTP server serves browser assets on its own port (3000 by default). A built worker runs in a separate Bun process.

Put preview dependencies in `docker-compose.preview.yml` at the application root. Stack appends `-preview` to the resolved Compose project name to isolate Compose-managed containers and project-scoped volumes. Bind mounts, external volumes, and volumes with explicit names still use their configured locations. Preview uses the same policies as development, selected independently in `compose.preview`. Dev and preview can publish the same host ports, so stop dev first or configure separate ports in both Compose and Varlock.

## Development Compose dependencies

Put optional development dependencies in exactly `docker-compose.dev.yml` at the application root. This behavior is independent of whether the app uses Stack's Database Block. Without that file, `stack dev` performs no Docker checks or operations.

With the file present and Stack managing startup, Stack checks Docker CLI, Compose, and daemon access, then starts the whole Compose project and waits before launching application processes. The native readiness timeout is 120 seconds. Image pulls and builds can take additional time. Define healthchecks for dependencies that must accept connections before the application starts. A service without a healthcheck only needs to be running to satisfy Compose waiting.

```yaml
services:
  mailpit:
    image: axllent/mailpit
    ports:
      - "127.0.0.1:1025:1025"
      - "127.0.0.1:8025:8025"
```

Configure images, volumes, healthchecks, ports, profiles, and service environments through Docker Compose's native configuration. Stack uses normal Compose selection; it does not choose services or activate additional profiles. Application Varlock files are not automatically loaded or forwarded to Compose. Configure Compose's own environment mechanism explicitly when needed.

Set `compose.dev` or `compose.preview` in [Stack configuration](cli.md#configure-lifecycle-ownership) to choose the policy for that session.

- `managed` starts and stops the whole Compose project, including services that were already running. Containers and volumes are preserved.
- `start-only` starts the project and waits for readiness. Services stay running after the session or a partial startup.
- `external` leaves all Compose operations to the developer.

Both policies that start Compose hold a lock for the same Docker daemon and project for the duration of the session. Once managed startup begins, interrupted or failed startup triggers a stop attempt, including partially started services. Prerequisite-check failures leave the existing project alone. Shutdown stops application processes, runs the registered `post` script, and makes one bounded managed Compose cleanup attempt. Cleanup failure makes an otherwise successful session fail and preserves earlier failures and interrupts.

## Development diagnosis and explicit browser logs

Use `bunx --no-install stack doctor --json` to check structural detection and `bunx --no-install stack logs errors --json` for persisted request failures. Read [CLI workflows](cli.md) for selecting directories, tracing request IDs, and interpreting the limits of each check.

For explicit development output shared with browsers, use Stack's existing helper:

```ts
import { browserLog } from "@prinpo/stack/browser-log";

browserLog("Loaded invoice", { invoiceId });
```

The CLI wires backend forwarding automatically and the standard Vite preset supplies the receiver. Calls reach the server console and every connected browser; backend-only development retains server output. See [logging](logger.md) for best-effort delivery, production exclusion, and auth link/code logging. Ordinary `console` calls do not become browser broadcasts.
