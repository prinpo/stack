# Stack CLI

Stack includes a Linux/Bun CLI in `@prinpo/stack`. After installing Stack and application development tooling, use its local `stack` executable from package scripts or `bunx --no-install stack`. The executable and delegated JavaScript tools run on Bun. Keep `env = false` in application `bunfig.toml` so Bun package runners also leave dotenv precedence to Varlock. Vite+ remains application-owned development tooling; commands never download missing tools.

```sh
bunx --no-install stack dev
bunx --no-install stack build
bunx --no-install stack start
```

The source-linked repository example has one `stack` script pointing at the live source executable: Bun does not link the root package's own binary in this workspace. From the repository root, `bun run stack <command>` targets that example. The example keeps only this source shim and its `check` script; lifecycle and utility script aliases are unnecessary. An independently installed package exposes its ordinary local executable.

## Application commands

```sh
stack dev
stack build
stack start
stack start --env staging
stack doctor
stack doctor --json
```

Stack detects a frontend from root `index.html`, a backend from `src/server/index.ts`, and both for full-stack applications. It owns these conventions; no CLI config file or layout overrides are required. Keep native `vite.config.ts` for browser tooling and the normal deferred `startServer(() => import("./app"))` backend entry.

Human `dev`, `build`, and `doctor` output begins with a dimmed Prinpo Stack/version line. Chalk detects terminal color support, with `NO_COLOR` disabling colors and `FORCE_COLOR` available to force them. JSON doctor output and native env/log machine output have no decorative headers.

Development runs Vite+ and Bun's code watcher as one session. Frontend and backend terminal lines carry distinct colored labels, including stderr, while native tool colors are preserved in terminals. Screen clearing is disabled so one process cannot erase another's output. Ctrl+C stops the session; an unexpected process exit stops its siblings and fails the command. Any file change under an existing `env/server` restarts both processes so Vite refreshes proxy settings too. Native Vite integration handles client changes. Restart manually after creating schema directories or editing external schema imports.

If the application root contains `docker-compose.dev.yml`, development first checks Docker CLI, Compose, and daemon access, then starts the whole Compose project using native service/profile selection. Application processes launch only after Compose reports readiness, with a 120-second readiness timeout in addition to image pulls and builds. Define healthchecks for dependencies that must be ready to accept connections; without one, Compose only waits for the container to be running. Compose output and launch errors print directly. Developers manage Compose environment configuration through Docker's native mechanisms; Stack does not load application environment files for Compose or pass additional environment-file flags. Without this exact development filename, no Docker operations run.

The session stops application processes before stopping the whole Compose project, including services that were already running. Containers and volumes are preserved. Failed or interrupted Compose startup also triggers a stop attempt; prerequisite failures do not. Cleanup makes one bounded attempt and reports errors without hiding an earlier failure or interruption. Only one Stack development session may manage a given Docker daemon/Compose project at a time; its lock is released automatically on process exit. Dependencies stay running across application restarts. Restart development to apply Compose-file changes; ongoing container supervision and recovery of manually paused containers remain Docker-owned.

Builds validate static settings without deployment credentials, clear the previous manifest and owned outputs, and write `dist/manifest.json` only on success. Browser files are in `dist/client`; backend code is in `dist/server`. Startup requires a valid manifest and its advertised artifacts. It does not guess from stale files and does not require source entries to detect the built application. Schemas, dependencies, and other runtime assets remain required. Builds show separate frontend/backend sections and label native compiler output. The final summary reports Stack version, selected profile, uncompressed output bytes per enabled area, per-area validation/build time, and total elapsed time. Sizes exclude external dependencies; failed builds do not print a success summary.

Backend/full-stack startup hands off to Bun running `dist/server/index.js`. Frontend-only startup hands off to Stack's lightweight `Bun.serve` runtime. Both serve public dynamic configuration in prepared HTML, support HEAD and SPA navigation, and preserve missing-asset/API 404s. Public assets remain separate from server output. The CLI adds no ongoing production supervision or request handling.

Doctor explains structural capability detection and schema-directory presence. It starts nothing, makes no network calls, and resolves no credentials. Missing optional capabilities are informational; neither entry point produces a nonzero status. `--json` is suitable for agents.

## Profiles

Stack owns HOST, PORT, NODE_ENV, and APP_ENV. Defaults are `127.0.0.1`, `3000`, and development; APP_ENV defaults to NODE_ENV. NODE_ENV controls runtime behavior. APP_ENV selects configuration profiles independently of Vite's native mode.

`dev` fixes NODE_ENV to development. `build` and `start` fix it to production. Applicable commands accept `--env`; profile precedence is the explicit flag, inherited APP_ENV, then the runtime mode. For example, `stack start --env staging` loads `.env.staging` and `.env.staging.local` while retaining production serving and logging behavior. Static browser settings remain the values compiled during the build. Changing mode/profile discards incompatible inherited Varlock snapshots and their injected values while preserving genuine process overrides; compatible startup snapshots still resolve providers only once.

Use `env/client` and `env/server` for independent schemas. See [environment loading and classification](env.md) for schema annotations, public-only enforcement, local overrides, and credential-free build rules. Lower-level runtime helpers and direct Bun server startup remain available.

## Environment utilities

```sh
stack env load
stack env load --client --agent
stack env load --env staging --format json
stack env codegen
stack env codegen --client
stack env codegen --server
stack env run --env staging -- bun scripts/example.ts
```

Loading and execution default to the effective server graph, including Stack's owned declarations. `--client` selects the independent client schema. Server codegen includes Stack-owned declarations so generated types agree with build-time generation. Codegen defaults to both existing schemas, skipping absent optional directories; an explicitly selected missing directory fails. Existing invalid schemas or missing native code-generation annotations fail normally.

Native Varlock options and output pass through for these three operations. Use `--help` on the leaf command for native help. Arguments after `env run --` belong to the executed command, including its help flags. Additional Varlock operations are deferred.

## Local logs

```sh
stack logs
stack logs errors
stack logs request-id
stack logs --json
stack logs --follow --json
stack logs --env staging
stack logs --dir ./saved-logs --json
```

Native evlog selectors and filters pass through. One-shot JSON returns the native result object; following emits one JSON event per line. Stack keeps diagnostics on stderr and preserves tool exit statuses. CLI telemetry stays disabled.

Directory precedence is explicit `--dir`, then the selected profile's LOG_DIR, then `.evlog/logs`. Explicit directories skip environment loading. Otherwise only LOG_DIR and its dependencies resolve, without unrelated credentials. Runtime logger persistence also respects LOG_DIR unless explicitly configured. Production logs still use native JSON stdout; this command does not provide hosted production aggregation.

## Installation qualification

No dependency patches or consumer patch configuration are required. Stack owns static build validation and client exposure checks through its [unpatched Varlock integration](env.md#unpatched-varlock-integration).

Interactive menus, database/auth commands, scaffolding, production Docker workflows, broad import watching, and Windows support are deferred.
