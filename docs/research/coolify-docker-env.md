# Coolify Dockerfile deployment and environment configuration

Researched 2026-11-11 against official Coolify and Docker documentation. Scope: one Bun process serving browser assets and API through one public origin. **Documented facts** below describe upstream contracts; no live Coolify instance was tested. The repository and local Docker image verification are recorded below.

Read repository instructions, `GLOSSARY.md`, and ADRs [0003](../adr/0003-vite-plus-and-bun-with-a-single-public-origin.md) and [0009](../adr/0009-resolve-deployment-configuration-at-runtime.md). Those decisions require a single-origin production server and builds that do not require deployment credentials.

## Documented facts

### Dockerfile deployment

- Select the Git-backed **Dockerfile** build method. Coolify builds the image, then applies runtime configuration when creating the container. A Dockerfile entered directly without Git cannot `COPY` repository files. **Base Directory** defines the build context; **Dockerfile Location** is relative to that directory. Bind the process to `0.0.0.0` and configure **Ports Exposes** to its internal listening port. [Coolify Dockerfile](https://coolify.io/docs/applications/builds/dockerfile)
- Coolify's path example uses leading slashes for both fields: Base Directory `/apps/api` plus Dockerfile Location `/docker/Dockerfile` resolves to `/apps/api/docker/Dockerfile`. A named **Docker Build Stage Target** is optional; empty selects the final stage. [Coolify General](https://coolify.io/docs/applications/configuration/general#build-strategy)

### Build versus runtime variables

- Build and runtime availability are independent; new variables default to **both enabled**. Set runtime secrets to build unavailable, runtime available. Production and preview values are separate. Developer view supports an immediately preceding `# coolify: buildtime=false runtime=true` line. [Coolify environment variables](https://coolify.io/docs/applications/configuration/environment-variables#build-and-runtime-scope)
- Coolify supplies `PORT` from the first exposed port and `HOST=0.0.0.0` when not already set. Runtime-only changes need container recreation via Restart or deployment; changed build values require deployment. Literal interpolation preserves `$` characters in values. [Coolify environment variables](https://coolify.io/docs/applications/configuration/environment-variables)
- Automatic build-argument injection is the default: Coolify inserts `ARG` instructions for build-enabled variables. **Managed manually in Dockerfile** delegates all required declarations to the Dockerfile. `SOURCE_COMMIT` defaults to runtime only to preserve cache reuse. [Coolify Advanced](https://coolify.io/docs/applications/configuration/advanced#build-arguments)
- Docker `ARG` does not automatically become a runtime variable, but can survive in history/provenance. Dockerfile `ENV` persists into containers. Global `ARG` declarations must be consumed inside stages; descendants inherit their parent's declared arguments. Neither mechanism is suitable for credentials. [Docker build variables](https://docs.docker.com/build/building/variables/)

### Ports and health checks

- **Ports Exposes** lists internal ports; the first is the default proxy and health-check target. A domain's explicit port chooses another internal target. **Port Mappings** publishes host ports directly, bypasses domain proxy rules, and fixed host ports prevent rolling replacement. [Coolify General](https://coolify.io/docs/applications/configuration/general#ports-exposes)
- Dockerfile `EXPOSE` documents a port; it does not publish it or make the process listen. [Docker EXPOSE](https://docs.docker.com/reference/dockerfile/#expose)
- Checks execute inside the container against its internal port. Dashboard HTTP checks require `curl` or `wget` in the **final image**. A Dockerfile check requires whichever executable its command uses. [Coolify health checks](https://coolify.io/docs/applications/configuration/health-checks)
- The live health-check page says an **enabled dashboard check overrides the image's `HEALTHCHECK`**; disable the dashboard check and redeploy to use the image instruction. It also says Expected code/text fields currently are not compared: generated HTTP checks use command exit status. [Coolify health checks](https://coolify.io/docs/applications/configuration/health-checks#choose-where-to-define-the-check)
- With Traefik, unhealthy containers leave routing; no healthy targets can produce 404 or “No available server.” Health checks support readiness-based replacement, but do not alone guarantee zero downtime. [Coolify health checks](https://coolify.io/docs/applications/configuration/health-checks#health-checks-and-rolling-updates)

### Build secrets

- Coolify offers **Build secrets → Docker BuildKit secrets** for sensitive build values, but documents a **fallback to build arguments if BuildKit is unavailable**. Merely selecting this mode therefore does not prove secure delivery on a particular builder. [Coolify environment variables](https://coolify.io/docs/applications/configuration/environment-variables#build-and-runtime-scope)
- Docker's native interface has two parts: supply `docker build --secret id=TOKEN,env=TOKEN .`, then consume it in a `RUN --mount=type=secret,id=TOKEN ...` instruction. Default file target is `/run/secrets/TOKEN`; `env=TOKEN` on the mount instead exposes it as a temporary environment variable for that instruction. [Docker build secrets](https://docs.docker.com/build/building/secrets/)
- Mount option `required=true` fails the instruction when the secret is absent. Mounting as an environment variable requires Dockerfile syntax v1.10.0 or later. [Docker secret mount reference](https://docs.docker.com/reference/dockerfile/#run---mounttypesecret)
- `.dockerignore` removes matching files before the context reaches the builder. [Docker build context](https://docs.docker.com/build/concepts/context/#dockerignore-files)

## Design implications and remaining verification

These are recommendations/inferences, not verified implementation facts:

- Use one Git-backed Dockerfile application, one public domain, and one internal Bun port for both browser and API traffic. For example, align `HOST=0.0.0.0`, `PORT=3000`, `EXPOSE 3000`, Coolify Ports Exposes `3000`, and the health-check port; leave host Port Mappings empty for normal proxy routing. This follows the documented networking model and ADR 0003.
- Keep deployment credentials and deployment-specific public configuration runtime-only, consistent with ADR 0009. Runtime injection cannot rewrite values already compiled into browser JavaScript; preserve the application's runtime public-configuration mechanism. The parent must verify its implementation and required runtime files.
- Keep private dotenv files out of the context, while retaining committed schema/public configuration needed at runtime. Do not blanket-ignore schema files merely because their names begin with `.env`.
- Build secrets should be unnecessary unless dependency installation genuinely needs credentials. If needed, verify the installed Coolify version, actual builder capability, secret IDs, and generated Dockerfile/build invocation. The consulted Coolify pages do not specify enough custom-Dockerfile mount wiring to claim that a particular mount works automatically. Docker examples above describe Docker itself.
- Secret mounts protect delivery, not arbitrary build output: do not copy credentials into layers or print them. A command can still embed secret-derived data in its output.
- Choose one health-check owner. A Bun-based command check could avoid installing an HTTP client, but its command, failure exit status, endpoint, and startup timing require verification. A real readiness route should not accidentally succeed through the SPA fallback.
- **Documentation discrepancy:** search-index excerpts claimed image `HEALTHCHECK` takes precedence; the directly opened live page consistently states dashboard precedence. Follow the live guidance above, and inspect the resulting container health-check configuration on the target Coolify release before relying on it.

The upstream research above was read-only. Local repository and image verification follows.

## Repository findings and initial Dockerfile

Both schemas already use the original process environment as overrides: [server loader](../../src/env/server.ts), [environment handling](../../src/env/environment.ts). The server and client snapshots are separate, but both receive the same caller-provided values. The client snapshot selects explicitly public dynamic keys; [server startup](../../src/start-server.ts) injects them using [HTML hydration](../../src/env/html.ts). No script splitting one env input into two files is needed. Keep names distinct when client/server values must differ: a genuine process override with the same name reaches both schemas.

The [CLI build](../../src/cli/lifecycle.ts) validates static inputs and produces `dist/client`, `dist/server`, and a success manifest. It leaves package imports external. The current workspace example uses `file:../..`, so deployment must retain root package source, installed dependencies, and the example's relative directory layout. The Dockerfile below is specific to this repository; an independently installed application can simplify its paths. It intentionally retains development dependencies for the first version.

Two schema directories remain useful for validation/exposure; value files are optional when all required values are injected. In this exact example, retain the committed static/demo defaults and production profiles, and override dynamics from Coolify. Client `@static` settings are compiled into browser assets and need a rebuild to change. Server `@static` values are validated during build and read again on startup; real deployment credentials should be `@dynamic`, unlike the deliberate dummy static-secret teaching field.

Place this Dockerfile at repository root, with the following ignore file at root as `.dockerignore`. The validation used identical contents from temporary files, using Dockerfile-specific ignore naming.

```dockerfile
# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS build
WORKDIR /app

# The example depends on the repository root via file:../.. .
COPY . .
# Skip the repository's prepare hook, which installs development Git hooks.
RUN bun install --frozen-lockfile --ignore-scripts
WORKDIR /app/examples/fullstack
RUN bun run stack build

FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# External package imports and the source-linked Stack package are still needed.
# Keep all dependencies for this first version; optimize pruning separately.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/bunfig.toml ./
COPY --from=build /app/src ./src
COPY --from=build /app/examples/fullstack/package.json /app/examples/fullstack/bunfig.toml ./examples/fullstack/
COPY --from=build /app/examples/fullstack/env ./examples/fullstack/env
COPY --from=build /app/examples/fullstack/dist ./examples/fullstack/dist

WORKDIR /app/examples/fullstack
RUN mkdir -p .evlog/logs && chown -R bun:bun .evlog
USER bun
EXPOSE 3000
CMD ["bun", "--no-env-file", "../../src/cli/main.ts", "start"]
```

```dockerignore
.git
**/node_modules
**/dist
**/.evlog
**/.tanstack
.stack-test-*
**/.env*
!src/env/.env.schema
!examples/fullstack/env/client/.env.schema
!examples/fullstack/env/client/.env
!examples/fullstack/env/client/.env.production
!examples/fullstack/env/server/.env.schema
!examples/fullstack/env/server/.env
!examples/fullstack/env/server/.env.production
```

The `.env` allowlist is specific to the example's public settings and dummy server values; do not generalize it to real private value files. Schema imports also need their referenced files retained.

`--ignore-scripts` avoids this repository's `prepare: vp config` Git-hook setup. A first build without this option failed because Git was absent in the Bun image. Reassess this flag when adding dependencies that require install scripts; it skips dependency scripts too.

### Coolify configuration

Use Dockerfile build strategy, Base Directory `/`, Dockerfile Location `/Dockerfile`, final stage (no target), Ports Exposes `3000`, and a public domain. Leave host Port Mappings empty for normal proxy routing. The Dockerfile sets `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`; runtime values may override them, but the listener and proxy port must agree. `APP_ENV` defaults to production under `stack start`; optionally set `APP_ENV=staging` while retaining production runtime behavior.

For runtime variables, disable build availability and enable runtime availability. Example Developer view input using only dummy values:

```dotenv
# coolify: buildtime=false runtime=true
CLIENT_PUBLIC_DYNAMIC=My deployed application
# coolify: buildtime=false runtime=true
SERVER_PUBLIC_DYNAMIC=production-service
# coolify: buildtime=false runtime=true
SERVER_SECRET_DYNAMIC=demo-only-value
```

Never put real credentials into the example's `SERVER_SECRET_*` fields: `/api/env` deliberately returns them. A real application's credentials belong in new server-only dynamic declarations and must not be returned by routes.

No Docker `ARG` is required for runtime values. If a public static value genuinely must come from Coolify, enable build availability, declare `ARG CLIENT_PUBLIC_STATIC` inside the build stage before `RUN bun run stack build`, and use manually managed Dockerfile build arguments. A changed client static value requires rebuilding; deployment-specific client settings should generally be public dynamic instead. No `VITE_` prefix is required by the schema-driven `ENV` interface.

The prototype leaves health checks to a subsequent explicit setup. The example has no dedicated readiness endpoint. If enabling Coolify's HTTP checks, verify `curl`/`wget` exists in the final image, or use a tested Bun-based image health check with the dashboard check disabled. File logs under `.evlog/logs` are ephemeral unless a correctly owned persistent volume is configured.

### Validation

- Installed locked dependencies with `bun install --frozen-lockfile`. Global `vp` was unavailable; `bunx --bun vp env doctor` reported that env commands require the global CLI. After installation, the local Vite+ commands worked.
- `bun run stack build` passed without deployment overrides.
- `bunx --bun vp check` passed formatting, linting, and types; `bunx --bun vp test` passed all 695 tests in 49 files.
- Built `stack-coolify-research:initial` locally using Docker and Bun 1.4.4, without any deployment build arguments or credentials.
- Started that same image twice with different process env overrides. Both passed public dynamic HTML injection, server dynamic overrides, API requests, root/index/deep-link navigation (with browser HTML Accept headers), and the check that runtime client static overrides do not rewrite HTML. Containers were removed after verification. No live Coolify deployment was performed.
