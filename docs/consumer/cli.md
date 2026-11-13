---
title: Stack CLI for agents
description: Select Stack commands to inspect application structure, retrieve logs, validate configuration, generate schemas and migrations, and run application lifecycles.
type: workflow
topics: [cli, diagnostics, logs, migrations, authentication, environment]
related:
  title: Related
  links: [development.md, production.md, env.md, logger.md, database.md, auth.md]
---

# Stack CLI for agents

Run commands from the consuming application's root. Stack's CLI supports Linux and Bun. Use the installed executable from a package script, or `bunx --no-install stack <command>`; the commands below use that explicit form. Missing tooling is an installation problem: Stack never downloads tools implicitly. Vite+ is application-owned development tooling.

Keep this application `bunfig.toml` setting so Varlock owns dotenv precedence even when Bun runs package scripts:

```toml
env = false
```

For direct execution, `bun --no-env-file` also disables Bun dotenv loading.

## Choose a command by evidence needed

| Task                                       | Command                                               | What the result establishes                                                             |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Inspect a new or unfamiliar application    | `bunx --no-install stack doctor --json`               | Detected entry points, schema directories, Compose, database migrations, and auth files |
| Inspect recent request failures            | `bunx --no-install stack logs errors --json`          | Persisted local error events                                                            |
| Trace one request                          | `bunx --no-install stack logs <request-id> --json`    | Persisted events selected by the native request selector                                |
| Watch a reproduction                       | `bunx --no-install stack logs --follow --json`        | New local events as newline-delimited JSON                                              |
| Inspect configuration                      | `bunx --no-install stack env load --agent`            | The native effective server configuration report                                        |
| Check auth generation drift                | `bunx --no-install stack auth check`                  | Generated auth schema matches current configuration                                     |
| Inspect auth configuration                 | `bunx --no-install stack auth info`                   | JSON config/schema paths, adapter, and enabled plugin IDs                               |
| Generate SQL after schema changes          | `bunx --no-install stack db generate --name <change>` | New native Drizzle migration artifacts                                                  |
| Check migration history                    | `bunx --no-install stack db check`                    | Native Drizzle migration consistency checks                                             |
| Apply migrations to a development database | `bunx --no-install stack db migrate`                  | Native migrator completed against the selected database                                 |

Use the actual command exit status when deciding whether a step succeeded. Stack preserves native tool output and failure statuses; its own diagnostics go to stderr. Use leaf-command `--help` to discover native flags rather than guessing them.

## Structural diagnosis with doctor

```sh
bunx --no-install stack doctor --json
bunx --no-install stack doctor --auth-config src/server/auth/options.ts --auth-schema src/server/database/auth.generated.ts --json
```

Doctor is offline and structural: it imports no application configuration, starts no services, resolves no credentials, and connects to no database. Its JSON has `frontend`, `backend`, `env`, `database`, `auth`, and `compose` sections. Inspect each section's `enabled`, `ready`, and `reason` fields where present. `env.client` and `env.server` are directory-presence booleans. `compose.enabled` and `compose.reason` explain exact-file detection.

Respond to findings at their actual boundary:

- No application detected: add the intended entry at `src/index.html` and/or `src/server/index.ts`.
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
bunx --no-install stack start
bunx --no-install stack start --env staging
bunx --no-install stack --help
bunx --no-install stack --version
```

`dev` uses `NODE_ENV=development`; `build` and `start` use `production`. All three accept `--env` and reject extra arguments. Profile precedence is explicit `--env`, inherited `APP_ENV`, then command mode. `APP_ENV` chooses `.env.<profile>` files independently of Vite's mode. Utility commands retain the inherited `NODE_ENV`, defaulting to development, and accept `--env` where documented. Doctor and secret generation need no profile.

Read [development](development.md) for process/watch/Compose behavior and [production](production.md) for build artifacts, startup, migrations, and shutdown. Interactive scaffolding, production Docker orchestration, and Windows CLI support are outside the supported command surface.
