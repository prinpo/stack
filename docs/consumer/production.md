---
title: Build and production lifecycle
description: Build credential-free Stack artifacts, supply deployment configuration, start managed migrations and serving, and close application resources on shutdown.
type: reference
topics: [production, build, deployment, runtime-configuration, migrations, shutdown]
related:
  title: Related
  links: [cli.md, env.md, database.md, auth.md, backend.md, jobs.md, logger.md]
---

# Build and production lifecycle

Use `stack preview` to exercise a build locally with its dependencies. Reserve `stack start` and `stack worker` for production deployments. They are independently supervised Bun entry points for HTTP and jobs. A Docker image can expose both commands and run one per service. Custom output for Vercel or Cloudflare Workers requires application-owned packaging and a compatible platform entry point. Stack's CLI targets Linux with Bun. The deployment owns infrastructure, process supervision, credentials, and backups.

## Build contract

```sh
bunx --no-install stack build
bunx --no-install stack build --env staging
```

Build sets `NODE_ENV=production`, chooses `APP_ENV` from `--env`, inherited `APP_ENV`, or production, and validates static settings without resolving dynamic deployment credentials. Classify deployment-specific settings as dynamic; a static setting with a dynamic dependency fails validation. See [environment](env.md) for schema rules.

Stack removes the previous manifest and its owned client, server, and database outputs. It builds browser code through the local Vite+ toolchain and uses Bun to validate server and worker entry points before packaging their modules. It writes `dist/manifest.json` after a successful build. The summary reports Stack version, profile, uncompressed output bytes, and build times.

| Artifact             | Purpose                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `dist/manifest.json` | Version 2 manifest declaring frontend, backend, worker, and managed database artifacts |
| `dist/client/`       | Browser files, including the HTML shell and assets                                     |
| `dist/server/`       | Packaged application modules under `src/`, plus `index.js` when an HTTP backend exists |
| `dist/database/`     | Built database config and complete migration folders when enabled                      |

Keep application runtime dependencies installed: server builds externalize packages. Ship the manifest, enabled artifacts, required environment schemas/files, and any application-owned runtime assets. Public files are separate from server output. Ship the complete `dist/server/` tree. The backend launcher imports `dist/server/src/server/index.ts`, and the worker command runs `dist/server/src/server/worker.ts`. Bun resolves deferred imports and relative processor URLs from that tree. Keep runtime path aliases and `baseUrl` targets inside the application. Successful build does not prove production credentials or connections are valid.

When root `drizzle.config.ts` enables the database, build requires existing migrations and packages complete native folders, including snapshots. Generate and inspect migrations before building; see [database](database.md) and [CLI migration commands](cli.md).

## Startup and reusable artifacts

```sh
bunx --no-install stack start
bunx --no-install stack start --env staging
```

Start requires a valid `dist/manifest.json` and its advertised artifacts. Missing/invalid artifacts are errors; rerun build rather than relying on stale output detection. Start sets production mode and the chosen deployment profile, then hands off to Bun running the built backend or Stack's frontend-only server. The CLI is not an ongoing process supervisor.

Standard backend [startup](backend.md) resolves and validates server configuration before importing application modules. Production resolves public client dynamic values separately and injects them into an in-memory HTML shell before browser modules evaluate. Static public client values remain compiled into the browser artifact. Rebuild older manifests before deploying with the current CLI.

The same artifact can run under different dynamic settings; configuration changes require restarting startup.

Use `HOST=0.0.0.0` when a deployment must listen beyond container loopback; defaults are `HOST=127.0.0.1` and `PORT=3000`. Set values through declared server configuration or process overrides, without redeclaring Stack-owned connection schemas. Keep Bun's automatic dotenv loading disabled and let Varlock select profile files.

Frontend-only startup reads connection settings and public client dynamics without resolving unrelated backend credentials, unless a managed database requires full server configuration for migration. Public runtime HTML uses `Cache-Control: no-store`; avoid deployment caching that would retain another deployment's configuration.

## Migrations and auth readiness

When a managed database is enabled, `stack start` runs its packaged migrations before application import and listening. This includes frontend-only applications with database configuration. Migration failure prevents startup. Direct built backend execution through standard `startServer` also follows the production migration boundary.

Do not replace this with development `push` or a private application migration runner. Stack does not coordinate simultaneous migrations across replicas; the deployment owns rollout coordination and recovery. Provision/reset/seed operations remain application/native workflows.

Standard backend startup waits for plugins and checks registered auth configuration before opening the listener. Enabled wrapped auth delivery flows need production senders; development console delivery does not satisfy that requirement. See [authentication](auth.md). `doctor`, `auth check`, and successful SQL generation do not prove those runtime requirements.

Registered jobs producers must reach datastore readiness before HTTP opens. Supply the same Redis connection, queue names, and prefix to HTTP and worker replicas.

## Deploying workers

Use the same build for both services. Finish migrations, then run `stack worker --check` with the deployment profile to initialize the configured queues, handlers, and sandbox contexts. This command starts a fresh process and exits before fetching a job. Supervise each consuming replica with `stack worker`. For a worker-only deployment with a managed database, arrange the migration step separately.

During a rolling deployment, make every consumer understand a new job name or input shape before enabling producers that submit it. Unknown job names and inputs rejected by the worker schema fail permanently. For an incompatible payload, register a distinct job name and keep the old handler until queued, delayed, and retrying work has drained.

Monitor live queue progress alongside process status. Infrastructure errors, including an unexpected consumer-loop rejection, go to the runtime’s `onError` callback (by default, `console.error`). A stopped consumer loop can leave the process alive. A growing waiting queue with no completions warrants checking the worker logs and restarting the affected replica. See [job logging and business results](jobs.md#job-logging-and-database-results).

## Serving behavior

The normal full-stack origin serves `/api` and built browser assets together. Root HTML, explicit `index.html`, and SPA navigation share the prepared shell; unknown API paths, missing assets, and application failures retain their error behavior. GET/HEAD handling is supported. Backend-only startup omits browser serving; frontend-only startup uses a lightweight Bun server without Elysia application code.

Use [backend serving helpers](backend.md) for custom assets, API prefixes, or HTML transforms. Application transforms run before Stack's dynamic-client injection in standard startup. Active development `browserLog` output is excluded from built execution; the complete helper is inert even when a built app is launched with development mode. Ordinary JavaScript argument evaluation still occurs.

## Shutdown and diagnosis

`startServer` handles SIGINT/SIGTERM, reports stopping, and calls `app.stop()` by default. Stack stops HTTP admission, waits for admitted requests, then closes that process’s jobs producer before the application cleanup callback. A worker receiving SIGTERM drains its own active attempts within `JOBS_SHUTDOWN_TIMEOUT_MS`. Attach native application `onStop` hooks to close database clients and other resources. A custom `onStop(status, app)` startup option replaces the default stop action; it must perform the required shutdown. Failures are reported with a failing exit status, and Stack still attempts to stop the listener. See [backend helper options](backend.md).

Production logging uses native JSON stdout and disables default development file persistence. Send stdout/stderr to deployment-owned aggregation. `stack logs` reads local event files; it does not fetch remote production logs. Diagnose startup from the failing phase's actual output: manifest/artifact checks, configuration resolution, migration, auth validation, then listen. Read [logging](logger.md) for public error projection and application request context.

## One image with independently scaled workers

From the repository root, build the fullstack example image and run its production Compose project. The `app` service runs `stack start` and each `worker` service runs `stack worker` from the same image. The example sets a 35-second container stop grace period for the 30-second jobs drain and 2.5-second cleanup allowance.

```sh
docker build -f examples/fullstack/Dockerfile -t stack-example:local .
# Set BETTER_AUTH_SECRET and BETTER_AUTH_URL first.
docker compose -f examples/fullstack/docker-compose.production.yml up -d
docker compose -f examples/fullstack/docker-compose.production.yml up -d --scale worker=4
```

The example starts two worker replicas after HTTP has finished migrations and passed its healthcheck. Redis uses append-only persistence, a named data volume, and the `noeviction` memory policy. The app and workers share a SQLite volume on one host. Mailpit captures demo auth emails and publishes its inbox on loopback. Real deployments supply their own mail delivery and credentials.
