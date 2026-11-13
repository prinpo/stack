---
title: Build and production lifecycle
description: Build credential-free Stack artifacts, supply deployment configuration, start managed migrations and serving, and close application resources on shutdown.
type: reference
topics: [production, build, deployment, runtime-configuration, migrations, shutdown]
related:
  title: Related
  links: [cli.md, env.md, database.md, auth.md, backend.md, logger.md]
---

# Build and production lifecycle

Stack provides build and start commands for frontend-only, backend-only, and full-stack applications. The CLI supports Linux and Bun. Deployment infrastructure, process supervision, credential provisioning, backups, database provisioning, and production Docker orchestration belong to the application/deployment environment.

## Build contract

```sh
bunx --no-install stack build
bunx --no-install stack build --env staging
```

Build sets `NODE_ENV=production`, chooses `APP_ENV` from `--env`, inherited `APP_ENV`, or production, and validates static settings without resolving dynamic deployment credentials. Classify deployment-specific settings as dynamic; a static setting with a dynamic dependency fails validation. See [environment](env.md) for schema rules.

Stack removes the previous manifest and its owned client/server/database outputs. It builds detected browser code through the local Vite+ toolchain and backend code through Bun with external packages. `dist/manifest.json` is written only after success. The summary reports Stack version, profile, uncompressed output bytes, per-area validation/build time, and total duration; sizes exclude external dependencies.

| Artifact               | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `dist/manifest.json`   | Versioned declaration of the successfully built capabilities      |
| `dist/client/`         | Browser files, including the HTML shell and assets                |
| `dist/server/index.js` | Bun backend entry when the application has a backend              |
| `dist/database/`       | Built database config and complete migration folders when enabled |

Keep application runtime dependencies installed: server builds externalize packages. Ship the manifest, enabled artifacts, required environment schemas/files, and any application-owned runtime assets. Public files are separate from server output. Source entry files are unnecessary for manifest-based startup. Successful build does not prove production credentials or connections are valid.

When root `drizzle.config.ts` enables the database, build requires existing migrations and packages complete native folders, including snapshots. Generate and inspect migrations before building; see [database](database.md) and [CLI migration commands](cli.md).

## Startup and reusable artifacts

```sh
bunx --no-install stack start
bunx --no-install stack start --env staging
```

Start requires a valid `dist/manifest.json` and its advertised artifacts. Missing/invalid artifacts are errors; rerun build rather than relying on stale output detection. Start sets production mode and the chosen deployment profile, then hands off to Bun running the built backend or Stack's frontend-only server. The CLI is not an ongoing process supervisor.

Standard backend [startup](backend.md) resolves and validates server configuration before importing application modules. Production resolves public client dynamic values separately and injects them into an in-memory HTML shell before browser modules evaluate. There is no environment-fetch endpoint. Static public client values remain compiled into the browser artifact. The same artifact can run under different dynamic settings; configuration changes require restarting startup.

Use `HOST=0.0.0.0` when a deployment must listen beyond container loopback; defaults are `HOST=127.0.0.1` and `PORT=3000`. Set values through declared server configuration or process overrides, without redeclaring Stack-owned connection schemas. Keep Bun's automatic dotenv loading disabled and let Varlock select profile files.

Frontend-only startup reads connection settings and public client dynamics without resolving unrelated backend credentials, unless a managed database requires full server configuration for migration. Public runtime HTML uses `Cache-Control: no-store`; avoid deployment caching that would retain another deployment's configuration.

## Migrations and auth readiness

Managed production database migrations run on every startup before application import/listening. This includes frontend-only applications with database configuration. Migration failure prevents startup. Direct built backend execution through standard `startServer` also follows the production migration boundary.

Do not replace this with development `push` or a private application migration runner. Stack does not coordinate simultaneous migrations across replicas; the deployment owns rollout coordination and recovery. Provision/reset/seed operations remain application/native workflows.

Standard backend startup waits for plugins and checks registered auth configuration before opening the listener. Enabled wrapped auth delivery flows need production senders; development console delivery does not satisfy that requirement. See [authentication](auth.md). `doctor`, `auth check`, and successful SQL generation do not prove those runtime requirements.

## Serving behavior

The normal full-stack origin serves `/api` and built browser assets together. Root HTML, explicit `index.html`, and SPA navigation share the prepared shell; unknown API paths, missing assets, and application failures retain their error behavior. GET/HEAD handling is supported. Backend-only startup omits browser serving; frontend-only startup uses a lightweight Bun server without Elysia application code.

Use [backend serving helpers](backend.md) for custom assets, API prefixes, or HTML transforms. Application transforms run before Stack's dynamic-client injection in standard startup. Active development `browserLog` output is excluded from built execution; the complete helper is inert even when a built app is launched with development mode. Ordinary JavaScript argument evaluation still occurs.

## Shutdown and diagnosis

`startServer` handles SIGINT/SIGTERM, reports stopping, and calls `app.stop()` by default. Attach native application `onStop` hooks to close database clients and other resources. A custom `onStop(status)` startup option replaces the default stop action; it must perform the required shutdown. Failures are reported with a failing exit status, and Stack still attempts to stop the listener. See [backend helper options](backend.md).

Production logging uses native JSON stdout and disables default development file persistence. Send stdout/stderr to deployment-owned aggregation. `stack logs` reads local event files; it does not fetch remote production logs. Diagnose startup from the failing phase's actual output: manifest/artifact checks, configuration resolution, migration, auth validation, then listen. Read [logging](logger.md) for public error projection and application request context.
