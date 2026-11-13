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

Use `bunx --no-install stack dev` from the application root to run detected capabilities as one development session. `src/index.html` enables the frontend and `src/server/index.ts` enables the backend. A frontend-only or backend-only application omits the other entry. See [application patterns](application-patterns.md) for configuration and layout, and [CLI diagnosis](cli.md) for checking detection.

## Toolchain and public origin

Install Bun and application-local Vite+ tooling. Run direct Vite+ commands with `bun --bun vp <command>`; a global installation is optional. Stack's CLI resolves the installed frontend tool and runs delegated JavaScript tools on Bun. `bun --bun vp dev` starts Vite directly; the Stack CLI manages the combined application lifecycle.

The [Stack Vite preset](frontend.md) combines React, file-route generation, optional public-client environment delivery, and optional API proxying. With `stack({ api: true })`, the browser uses its own origin for `/api`, and Vite forwards those requests to the backend. Stack reads only connection settings and dependencies from the server schema to derive that target; unrelated credential resolvers do not run. Wildcard backend binds map to loopback for proxy connections.

File-route generation owns generated route output. Keep generated files out of formatting/linting and modify route source instead. Configuration remains native Vite+ configuration at the application root. Public files live under `src/public/`; HTML at `src/index.html` references `/main.tsx` because `src/` is Vite's root.

## Watching and session ownership

Stack launches Vite+ for browser development and Bun's code watcher for the backend. Frontend/backend output has distinct labels, including stderr, and screen clearing is disabled. Native tool colors are preserved in terminals. `NO_COLOR` disables colors; `FORCE_COLOR` can force them.

An unexpected child exit stops its siblings and fails the session. Ctrl+C stops application processes, then managed Compose services. Use one managed development session for an application rather than starting conflicting copies on the same ports.

| Change                                                             | Development behavior                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Browser source/routes                                              | Native Vite/React/router tooling handles updates                                                    |
| Backend imports/source                                             | Bun code watcher reloads the backend                                                                |
| Files under an existing `env/server/` in a backend application     | Stack restarts backend and frontend so the derived proxy target refreshes                           |
| Client schema sources                                              | Vite tracks schema configuration dependencies; dynamic client values are read when HTML is prepared |
| Newly created schema directories or external server-schema imports | Restart `stack dev` manually                                                                        |
| `docker-compose.dev.yml`                                           | Restart `stack dev` manually                                                                        |

Compose dependencies stay running while application processes restart. Stack does not provide general infrastructure reconfiguration or recovery after readiness succeeds.

## Development Compose dependencies

Put optional development dependencies in exactly `docker-compose.dev.yml` at the application root. This behavior is independent of whether the app uses Stack's Database Block. Without that file, `stack dev` performs no Docker checks or operations.

With the file present, Stack checks Docker CLI, Compose, and daemon access, then starts the whole Compose project and waits before launching application processes. The native readiness timeout is 120 seconds; image pulls and builds can take additional time. Define healthchecks for dependencies that must accept connections before the application starts. A service without a healthcheck only needs to be running to satisfy Compose waiting.

```yaml
services:
  mailpit:
    image: axllent/mailpit
    ports:
      - "127.0.0.1:1025:1025"
      - "127.0.0.1:8025:8025"
```

Configure images, volumes, healthchecks, ports, profiles, and service environments through Docker Compose's native configuration. Stack uses normal Compose selection; it does not choose services or activate additional profiles. Application Varlock files are not automatically loaded or forwarded to Compose. Configure Compose's own environment mechanism explicitly when needed.

The session owns the whole Compose project and stops it on exit, including services that were already running before Stack started. Containers and volumes are preserved. Only one Stack session may manage the same Docker daemon/Compose project; its lock is released on process exit.

Once startup begins, interrupted or failed Compose startup triggers a stop attempt, including partially started services. Prerequisite-check failures alone do not trigger a stop. Shutdown stops application processes first, then makes one bounded Compose cleanup attempt. Cleanup errors are reported without hiding an earlier error or interrupt; cleanup failure makes an otherwise successful session fail. Manually paused containers retain Compose's native behavior.

## Development diagnosis and explicit browser logs

Use `bunx --no-install stack doctor --json` to check structural detection and `bunx --no-install stack logs errors --json` for persisted request failures. Read [CLI workflows](cli.md) for selecting directories, tracing request IDs, and interpreting the limits of each check.

For explicit development output shared with browsers, use Stack's existing helper:

```ts
import { browserLog } from "@prinpo/stack/browser-log";

browserLog("Loaded invoice", { invoiceId });
```

The CLI wires backend forwarding automatically and the standard Vite preset supplies the receiver. Calls reach the server console and every connected browser; backend-only development retains server output. See [logging](logger.md) for best-effort delivery, production exclusion, and auth link/code logging. Ordinary `console` calls do not become browser broadcasts.
