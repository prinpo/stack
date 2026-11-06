# Database Block

Design confirmed by the developer; implementation follows the decisions below. [ADR 0016](../adr/0016-manage-one-database-with-mandatory-production-migrations.md) records the lifecycle boundary; [ADR 0017](../adr/0017-retain-native-drizzle-import-paths-initially.md) records the temporary native-import exception. Evidence: [reference applications](../research/database-app-patterns.md) and [exact RC.5 research](../research/drizzle-rc5.md).

## Settled requirements

- Optional Block, with exact Stack-owned ORM and Kit `1.0.0-rc.5` dependencies.
- Preserve native Drizzle APIs, dialect/driver selection, schema/relations, inferred types, and application client options. PostgreSQL and Bun SQL must not become mandatory choices.
- Root `drizzle.config.ts` uses Stack-owned `defineConfig` from `@prinpo/stack/database` with native Kit settings. Do not duplicate dialect, schema paths, and connection settings in a parallel Stack configuration. The fixed source migration directory below is a documented convention in native configuration.
- Manage one database initially. Applications independently manage additional databases.
- Development performs no automatic database mutations. Developers explicitly push schema changes or generate/apply migrations as part of their development cycle.
- Production always applies committed migrations before accepting traffic when using the managed database lifecycle. No configurable skip or separate deployment-job mode in the initial version.
- Doctor remains offline and does not resolve credentials or connect to databases. Local migration counts are useful structural information; they are not a count of pending migrations in a live database.
- Database lifecycle tests use SQLite through **Bun SQL** (`drizzle-orm/bun-sql/sqlite`), not the synchronous `bun:sqlite` adapter. No PostgreSQL service is required. Verify Stack-owned orchestration, credential-free builds, artifact packaging, failure handling, and lifecycle behavior within that scope.
- Keep initial setup simple and almost configuration-free.
- Root `drizzle.config.ts` automatically enables managed database integration. No additional registration; invalid configuration must not silently disable the capability.
- Use native Kit `migrate` under Bun for explicit migrations and automatic production migrations. Kit is required in production; dependency/image size is an accepted initial trade-off to revisit with future Docker/image utilities.
- Concurrent-start coordination is deferred. Do not claim concurrency guarantees or introduce deployment orchestration in this milestone.
- Production startup fails when the configured migrations directory is missing or contains no migrations. Doctor reports the condition and explains that production cannot start until an initial migration is generated and committed.
- Seeding, fixtures, database creation/reset, and baseline enrollment are deferred. Native custom SQL migrations and application-owned scripts remain available.
- Source migration files live in exactly project-root `migrations/`, enforced by the config helper without a configurable `out` field. Doctor and build inspect this directory directly. Configurable or profile-dependent migration directories and importing/analyzing executable config for offline discovery are deferred.
- Build fails when managed migrations are missing or empty, catching the problem before deployment. Startup also validates required migration artifacts.
- The shared production startup lifecycle, including direct Bun startup through `startServer`, validates environment, applies migrations, imports the application, and only then accepts traffic. CLI startup must not migrate twice; development skips migration execution.
- Expose native `generate`, `migrate`, `push`, `pull`, `studio`, `check`, `up`, and `export` under `stack db`. Preserve native options/help and exit status, adding consistent Stack `--env` profile selection. Local operations must not require deployment secrets; connected operations use the selected server environment.
- Applications own construction and closure of runtime Drizzle clients. Stack owns its Kit subprocess lifecycle, including interruption, and server signal handling and offers an `onStop(status)` action, defaulting to native app stop. Demonstrate application client cleanup through that callback in the full-stack example.
- Build packages compiled Drizzle config and complete migration folders, including snapshots, under `dist/database` and records database capability/artifacts in the successful manifest. Build remains credential-free. Production requires no source config/schema files, but retains installed Kit and external driver dependencies. Credentials resolve at runtime.
- Frontend-only production startup applies the same migration gate when database capability is enabled. Database access is not exposed to browser code.
- Initially retain native `drizzle-orm/...` imports instead of mirroring their subpaths through Stack. Stack owns Kit’s config helper and enforces the migration output directory. This is a temporary, reluctantly accepted exception to the established reexport policy, not a change in exact dependency ownership. Qualify resolution and type inference in an independently installed Bun/Vite+ consumer.
- The full-stack example uses file-backed SQLite through Bun SQL, demonstrates persistent reads/writes and explicit native client cleanup, and requires no PostgreSQL service. Document PostgreSQL/Bun SQL configuration separately.
- Failure/interruption of migration execution terminates startup before application import/listen. Preserve native Kit diagnostics and add migration-stage context. Add no automatic retry, repair, rollback command, or schema-push fallback. A subsequent startup invokes the native migrator again; Stack does not implement a separate recovery engine.
- Doctor exits nonzero for enabled database capability with missing/empty migrations, explains that development may continue but production build/start cannot, and includes structured findings in `--json`. Report capability, migration directory, and local migration count. An absent optional Database Block remains informational.

## Qualification boundary

Use disposable file-backed SQLite through **Bun SQL**, real Kit subprocesses, and built consumers for integration acceptance. Do not connect to any reference application's databases. PostgreSQL servers and driver-specific concurrency qualification are outside the test scope.

- Optional absence: existing frontend/backend workflows operate without database imports, credential requirements, or Kit execution when no database capability is enabled.
- Development: startup/watch/restart does not push or migrate; explicit native database commands remain available.
- Native API: schema builders, relations, CRUD, transactions, and inferred types work through native imports in an independently installed consumer, with Stack's pinned ORM/Kit versions. Installed executable/driver resolution works without downloads.
- CLI/environment: exercise all eight operation dispatches, native options/help, profile selection, meaningful exit statuses, and interruption cleanup. Local commands and help work without deployment credentials. Connected operations use the selected server environment without launching the app. Kit's `pull --init` mutates migration history; `check` checks local history rather than live drift; `up` upgrades local formats rather than applying migrations. Document these native boundaries.
- Doctor: no config evaluation, environment resolution, database/file creation, network access, or process launch. Verify human/JSON capability/path/count/findings and nonzero missing-migration status.
- Build: no runtime credentials or provider calls; complete config/migration artifacts and manifest are emitted only for successful builds; enabled empty/missing migrations fail early; source config modules are bundled without execution.
- Production: start full-stack, backend-only, frontend-only, and direct `startServer` paths with enabled database support. Migration completes before application import/listening, executes once per startup path, preserves existing data on repeat startup, and applies newly added migrations on subsequent releases.
- Deployment artifacts: run a built consumer after removing source config/schema/migrations; missing advertised config/migration artifacts fail visibly rather than disabling database support or falling back to source files. Keep migration assets private. Resolve packaged migration paths deliberately and preserve application-relative SQLite connection-path semantics.
- Failure: invalid SQL/native migration failure and interrupted migration prevent application import/listen and terminate the owned subprocess. Verify the SQLite pending-batch failure/retry behavior exposed through Stack, without promising stronger rollback guarantees than native Kit/Drizzle provides.
- Example: persistent reads/writes across restarts, explicit client cleanup on shutdown, documented explicit development schema preparation, and mandatory production migrations.

Run repository-required `vp check`, `vp test`, relevant example checks/builds, and installed-consumer qualification after implementation.

## Implementation qualification

The full suite passes: 711 tests across 50 files. Sixteen public database integration tests exercise offline doctor, credential-free local commands, staging migration, source-free backend/frontend startup, repeat startup, schema upgrades, migration failure/rollback and explicit retry, subprocess interruption, and clean builds with generated environment modules. The packed-consumer test additionally verifies native Drizzle imports/types, relations, installed CLI execution, and production migration without source files in an independent Bun installation. These tests use disposable Bun SQL SQLite files; no reference application database is accessed.

Repository checks, example checks, and the full-stack example build pass. An HTTP smoke test against the built full-stack example verifies note creation/readback, persistence across restart, and graceful client shutdown with a disposable SQLite file. Concurrent startup and PostgreSQL/other drivers remain outside qualification as agreed.

Standards review: one configuration-reuse defect and two duplication findings resolved. Frontend-only startup reuses the validated connection snapshot; process-group primitives and file predicates are shared. Spec review: one clean-build ordering defect resolved by running static server validation/codegen before config compilation. Regression tests prove connection providers resolve once and generated environment imports work without resolving dynamic credentials. No review findings remain open.

## Deferred and native responsibilities

Multiple managed databases; concurrent-start coordination; a migration-disable/separate-deployment-job mode; configurable migration directories; offline executable-config analysis; online doctor and live drift checks; seeding/fixtures; provisioning/reset; custom baseline/repair/recovery machinery; automatic runtime-client ownership; Stack mirrors of Drizzle's export tree; Docker/image utilities and size optimization.

The initial code-first migration describes the declared schema at generation time, not existing database data. A database previously populated through schema push needs deliberate baseline enrollment using an application/native workflow; Stack does not infer or perform that enrollment. Native custom SQL migrations remain available for versioned data changes, subject to the selected dialect/migrator's transaction limitations. Application code owns query/transaction semantics and compatibility with already-running instances; SQLite qualification does not establish untested dialect/driver guarantees.

## Lifecycle and example follow-up

Stack now owns `defineConfig` through its database entry point; `out` is unavailable to callers, the returned output property is immutable, and CLI output overrides are rejected. Native ORM imports remain unchanged. Server signals and red shutdown logging live inside `startServer`, with an optional `onStop(status)` action for resource cleanup. Doctor uses the same status/detail rows for every section. The example adds notebook/note foreign keys, a separate native relations module, bidirectional relational queries, UI forms, and an additive migration preserving existing notes.

Follow-up qualification: the full suite passes with 711 tests. Public tests cover the immutable Stack config helper, rejected CLI output overrides, consistent/colorized doctor rows, default/custom/failed shutdown actions, repeated signals during asynchronous cleanup, and migration of existing notes into the notebook/notes schema with bidirectional relations. Root/example checks, native migration-history checking, the example build, and a disposable built-example HTTP persistence/shutdown smoke test all pass. The packed consumer uses and typechecks the Stack-owned config entry point.
