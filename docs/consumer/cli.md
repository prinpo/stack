---
title: Stack CLI for agents
description: Select Stack commands to inspect application structure, retrieve logs, validate configuration, generate schemas and migrations, and run application lifecycles.
type: workflow
topics: [cli, diagnostics, logs, migrations, authentication, environment, preview, workers]
related:
  title: Related
  links: [development.md, production.md, jobs.md, env.md, logger.md, database.md, auth.md]
---

# Stack CLI for agents

Run commands from the consuming application's root. Stack's CLI supports Linux and Bun. Use the installed executable from a package script, or `bunx --no-install stack <command>`; the commands below use that explicit form. Missing tooling is an installation problem: Application lifecycle commands never download tools implicitly; `init` explicitly installs the new project’s dependencies. Vite+ is application-owned development tooling.

Keep this application `bunfig.toml` setting so Varlock owns dotenv precedence even when Bun runs package scripts:

```toml
env = false
```

For direct execution, `bun --no-env-file` also disables Bun dotenv loading.

## Initialize an empty project

From the parent directory, run `bunx @prinpo/stack init`. It asks for a simple lowercase unscoped npm package name, then optional Zed/VS Code settings. Both or neither editor can be selected. All prompts finish before files are created.

```sh
bunx @prinpo/stack init my-app --no-editor
bunx @prinpo/stack@nightly init my-app --editor zed --editor vscode
```

A supplied name skips only the name prompt. Editor flags skip the editor prompt; without a terminal, omitted editor flags mean no editor files. Without a terminal or a name, initialization fails with usage instructions. Unknown editors, conflicting flags, path names, and all existing destinations are rejected before writing. `--editor` can be repeated; `--no-editor` cannot be combined with it.

Initialization installs the exact Stack release running the command and that release's pinned local tooling, plus compatible React peers. It creates editable configuration, `AGENTS.md`, a README, Git on `main`, and hooks; then formats and checks files and runs Vitest. No source, database, example tests, initial commit, or remote is generated. Dev/build require application entry points later. On failure or interruption after creation, inspect the retained project and follow the recovery command. Cancelling a prompt creates nothing.

Bun and Git are prerequisites. Linux is tested; the CLI does not reject other platforms, but unsupported operations may fail. Editor files do not install extensions: install Oxc for Zed or VS Code's recommended Vite Plus Extension Pack. Use local commands from the project root, such as `bun run check` and `bun run test`.

## Choose a command by evidence needed

| Task                                       | Command                                               | What the result establishes                                                                  |
| ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Inspect a new or unfamiliar application    | `bunx --no-install stack doctor --json`               | Detected entry points, schema directories, Compose, database migrations, and auth files      |
| Verify a built worker before deployment    | `bunx --no-install stack worker --check`              | Server configuration, datastore and handler initialization succeed in a fresh worker process |
| Inspect recent request failures            | `bunx --no-install stack logs errors --json`          | Persisted local error events                                                                 |
| Trace one request                          | `bunx --no-install stack logs <request-id> --json`    | Persisted events selected by the native request selector                                     |
| Watch a reproduction                       | `bunx --no-install stack logs --follow --json`        | New local events as newline-delimited JSON                                                   |
| Inspect configuration                      | `bunx --no-install stack env load --agent`            | The native effective server configuration report                                             |
| Check auth generation drift                | `bunx --no-install stack auth check`                  | Generated auth schema matches current configuration                                          |
| Inspect auth configuration                 | `bunx --no-install stack auth info`                   | JSON config/schema paths, adapter, and enabled plugin IDs                                    |
| Generate SQL after schema changes          | `bunx --no-install stack db generate --name <change>` | New native Drizzle migration artifacts                                                       |
| Check migration history                    | `bunx --no-install stack db check`                    | Native Drizzle migration consistency checks                                                  |
| Apply migrations to a development database | `bunx --no-install stack db migrate`                  | Native migrator completed against the selected database                                      |

Use the actual command exit status when deciding whether a step succeeded. Stack preserves native tool output and failure statuses; its own diagnostics go to stderr. Use leaf-command `--help` to discover native flags rather than guessing them.

## Structural diagnosis with doctor

```sh
bunx --no-install stack doctor --json
bunx --no-install stack doctor --auth-config src/server/auth/options.ts --auth-schema src/server/database/auth.generated.ts --json
```

Doctor is offline and structural: it imports no application configuration, starts no services, resolves no credentials, and connects to no database. Its JSON has `frontend`, `backend`, `worker`, `env`, `database`, `auth`, `compose`, and `previewCompose` sections. Inspect each section's `enabled`, `ready`, and `reason` fields where present. `env.client` and `env.server` are directory-presence booleans. `compose` reports the development Compose file and `previewCompose` reports the preview file.

Respond to findings at their actual boundary:

- If doctor finds no application, add the entry for the intended capability. Use `src/index.html` for a frontend, `src/server/index.ts` for HTTP, or `src/server/worker.ts` for a worker.
- Legacy root `index.html`: move it into `src/` and update its module URL and public assets; see [application patterns](application-patterns.md).
- Enabled database has no migrations: inspect the schema/config, generate and review a migration, then rerun doctor. Development can run before migrations exist; production build/start require them.
- Auth files missing: inspect the configured paths and use `auth info`, `auth generate`, and `auth check`; see [authentication](auth.md).
- Optional capability absent: treat it as informational unless the requested feature needs that capability.

Doctor returns nonzero for an absent application, obsolete frontend entry, or enabled database/auth capability that is not structurally ready. A green doctor result does not prove schema validity, credential validity, database connectivity, applied migrations, or successful auth delivery. Use the narrower commands below and runtime logs for those questions.

## Retrieve logs before changing code

```sh
bunx --no-install stack logs --json
bunx --no-install stack logs errors --json
bunx --no-install stack logs <request-id> --json
bunx --no-install stack logs --follow --json
bunx --no-install stack logs --env staging --json
bunx --no-install stack logs --dir ./saved-logs --json
bunx --no-install stack logs --help
```

One-shot `--json` returns the native result object; `--follow --json` emits one JSON event per line. Capture a bounded one-shot report first, correlate request IDs and fields, then follow while reproducing when necessary. Stop following after obtaining the evidence needed.

Directory precedence is explicit `--dir`, then selected-profile `LOG_DIR`, then `.evlog/logs`. `--dir` skips environment loading; otherwise Stack resolves only `LOG_DIR` and its dependencies, so unrelated missing application credentials need not block diagnosis. Native evlog selectors and filters pass through. Usage telemetry is disabled.

Empty results do not prove the request succeeded: verify the selected directory/profile, that the request occurred, and [logger persistence and filtering](logger.md). Production uses native JSON stdout; this command reads local files and supplies no hosted log aggregation.

## Configuration inspection and generation

```sh
bunx --no-install stack env load --agent
bunx --no-install stack env load --client --agent
bunx --no-install stack env load --env staging --format json
bunx --no-install stack env codegen
bunx --no-install stack env codegen --client
bunx --no-install stack env codegen --server
bunx --no-install stack env run --env staging -- bun scripts/job.ts
```

`load` and `run` default to the effective server graph, including Stack-owned connection settings. `--client` selects the independent public client graph. `--client` and `--server` are mutually exclusive. Codegen without a selector processes both existing conventional schema directories; absent optional directories are skipped, but an explicitly selected missing directory fails. Existing invalid schemas and missing generation annotations fail normally.

Use native Varlock options and output for these operations. Help before `env run --` describes the environment operation; arguments after `--`, including help flags, belong to the executed program. Server codegen includes Stack's owned declarations. Generated destinations must be literal paths inside `src/env-gen/`. See [environment](env.md) for exposure, profiles, and resolver behavior. Configuration reports may contain application data: keep credentials out of checked-in diagnosis artifacts.

## Database changes

Root `drizzle.config.ts` enables Stack's one managed database. Use native schema definitions through Stack's [database import paths](database.md).

```sh
bunx --no-install stack db generate --name add_notes
bunx --no-install stack db check
bunx --no-install stack db migrate
bunx --no-install stack doctor --json
```

After changing schema, generate SQL, inspect the resulting files under root `migrations/`, and check the migration history. Apply reviewed migrations to the intended development database explicitly. Commit complete native migration folders, including snapshots. Development does not mutate schemas automatically. Production startup migrates automatically before importing the app or listening.

| Command       | Use and configuration boundary                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `db generate` | Generate migration artifacts from schema; static configuration only                                                            |
| `db check`    | Check native migration consistency; static configuration only                                                                  |
| `db up`       | Upgrade migration snapshots using the native operation; static configuration only                                              |
| `db export`   | Export schema SQL using the native operation; static configuration only                                                        |
| `db migrate`  | Apply migrations; resolves runtime server configuration and connects                                                           |
| `db push`     | Push schema directly; resolves runtime configuration and changes the target database without producing reviewed SQL migrations |
| `db pull`     | Introspect the target; resolves runtime configuration and connects                                                             |
| `db studio`   | Open native Studio; resolves runtime configuration and connects                                                                |

Each command accepts Stack's `--env <profile>` plus native Drizzle flags. `--out` is rejected because Stack owns `./migrations`. Leaf help works without config or credentials, for example `bunx --no-install stack db generate --help`. Keep normal application development on reviewed migrations; select direct `push` intentionally for a disposable or otherwise appropriate target.

Migration-generation success does not prove migrations were applied. Doctor reports local artifacts only, and auth check reports generated schema only. Diagnose a runtime migration failure from its native output and the selected database settings; see [production startup](production.md).

## Authentication configuration

```sh
bunx --no-install stack auth info
bunx --no-install stack auth generate
bunx --no-install stack auth check
bunx --no-install stack auth secret
```

`info`, `generate`, and `check` support `--config`, `--output`, and `--env`. They load static settings and execute the chosen configuration in a separate Bun process without connecting to a database. Keep that module free of live database initialization, using the [auth configuration/runtime separation](auth.md).

`generate` creates native Drizzle auth schema; replacing an existing output requires explicit `--yes`. When auth options change, inspect the change, regenerate with `auth generate --yes`, then run `db generate` and review the SQL migration. `check` returns nonzero for missing or stale generated schema; it does not verify applied database migrations. `info` prints JSON with config/schema paths, adapter, and plugin IDs. `secret` produces a random secret without loading application configuration; store it using the application's server-secret mechanism.

## Lifecycle and profiles

```sh
bunx --no-install stack dev
bunx --no-install stack build
bunx --no-install stack preview
bunx --no-install stack preview --env preview
bunx --no-install stack start
bunx --no-install stack start --env staging
bunx --no-install stack worker --check --env staging
bunx --no-install stack worker --env staging
bunx --no-install stack --help
bunx --no-install stack --version
```

| Command         | Purpose                                        | `NODE_ENV`  | Default Varlock profile |
| --------------- | ---------------------------------------------- | ----------- | ----------------------- |
| `stack dev`     | Develop from source with watching              | development | development             |
| `stack build`   | Build deployable artifacts                     | production  | production              |
| `stack preview` | Run the last build and local services together | production  | development             |
| `stack start`   | Run the HTTP process in production             | production  | production              |
| `stack worker`  | Run a jobs worker in production                | production  | production              |

For these commands, `--env` takes precedence over inherited `APP_ENV`, then the default in the table applies. The profile selects runtime files for both the app and worker. Browser values compiled into the build keep their build-time values.

### Local build preview

After `stack build`, run `stack preview` from the application root. Stack reads the successful build manifest, starts dependencies from `docker-compose.preview.yml` if present, and waits for Compose readiness. Bun runs the built app locally. When both HTTP and a worker are present, preview waits for the HTTP entry to finish startup, including Stack’s database migrations, before launching the worker as a separate process. Frontend-only, backend-only and worker-only builds use the same command. In a worker-only build with the Database Block, preview applies the packaged migrations before importing the worker.

Preview runs without a source watcher. Rebuild after source edits and restart preview after runtime configuration changes. Ctrl+C stops HTTP, drains the worker, and stops the preview Compose project. A child startup failure or unexpected exit also ends the session.

Read [development](development.md) for process/watch/Compose behavior and [production](production.md) for build artifacts, startup, migrations, and shutdown.

## Jobs workers

`stack dev` detects `src/server/worker.ts` and runs it as a dedicated process alongside any frontend and backend entries. It starts Compose first, labels each process's output, drains the backend and worker on server source or shared dependency edits, and stops Compose after the application processes exit. A worker-only project uses the same command.

`stack doctor --json` reports the worker entry. `stack build` packages it. Run `stack worker [--env profile]` to consume jobs from the successful build, or `stack worker --check` to verify readiness and cleanup without consumption. Deploy worker replicas independently of HTTP.
