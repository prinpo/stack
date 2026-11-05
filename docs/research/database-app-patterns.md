# Database Block: application patterns and design questions

Inspected on 2026-11-05. These are observations from source, not endorsements of every pattern. No application databases were accessed and no reference applications were modified. Upstream RC verification is recorded separately in [drizzle-rc5.md](drizzle-rc5.md).

## Existing Stack boundaries

- [ADR 0001](../adr/0001-stack-owns-library-dependencies.md): Stack owns pinned integrated dependencies; optional Blocks need not have independent installation. Additional database drivers should be considered separately from the integrated ORM/Kit dependencies.
- [ADR 0002](../adr/0002-compose-independent-blocks-with-native-apis.md): preserve native APIs and inferred types, avoid artificial prerequisites, recommend layouts without scaffolding or enforcing runtime application structure.
- [ADR 0009](../adr/0009-resolve-deployment-configuration-at-runtime.md): builds work without deployment credentials; resolve and validate runtime configuration before importing application modules and accepting traffic.
- [ADR 0010](../adr/0010-own-application-commands-through-the-stack-cli.md): CLI conventions are deliberate, lower-level Block APIs remain usable independently. Database commands were deferred to this milestone.
- [ADR 0015](../adr/0015-manage-development-compose-through-stack-dev.md): `stack dev` already starts optional Compose dependencies before application processes. Database support must compose with that sequence, without becoming a prerequisite for Compose.
- `src/start-server.ts`: currently loads environment, imports the app, awaits Elysia modules, then listens. No database lifecycle exists yet.
- `src/cli/lifecycle.ts`: backend build externalizes packages and writes a capability manifest; start uses built artifacts rather than source detection. Migration files and any separate migration executable need an explicit artifact contract.
- `src/cli/doctor.ts`, [CLI docs](../cli.md): doctor is currently structural and offline, with no credential resolution, network access, or service startup. Online database checks would require a deliberate extension of this contract.

## Green Wedge: production startup, locking, and adoption

Source root: `/home/martini/Projects/greenwedge/green-wedge/`.

- `apps/api/drizzle.config.ts`: PostgreSQL, native schema/relations modules, committed migrations under `apps/api/drizzle`, explicit migration journal schema/table. ORM and Kit manifests both request `^1.0.0-rc.4`; this is not proof of the resolved installed version.
- `apps/api/src/db/client.ts`: Bun SQL pool with application-specific limits and a development global cache. This cache addresses the app's reload environment; Stack uses Bun process watching and must establish whether it needs such a cache at all.
- `apps/api/src/lib/database-migrations.ts`: resolves migration files from several working-directory candidates; reserves a single Bun SQL connection and holds a PostgreSQL advisory lock around migration and seeding. Uses native `drizzle-orm/bun-sql/migrator` and explicitly guards an existing app schema without migration history.
- `apps/api/src/lib/setup-database.ts`: records setup stage, duration, migration result, and reference-data seed result. Migration success and seed success are separate outcomes. Errors are rethrown after logging.
- `apps/api/src/lib/baseline-database.ts`: deliberately enrolls an existing schema using native migration initialization after explicit operator confirmation and checks. This solves adoption after schema push; it is distinct from provisioning an empty database.
- `apps/web/instrumentation.ts`: validates environment and awaits database setup during server initialization. It explicitly exits on failure because this app's Next.js host otherwise remains running after instrumentation rejection.
- `apps/web/Dockerfile`: explicitly copies the migration directory into the runtime image. Code compilation/tracing alone does not supply those files.

Extract the startup gate, explicit artifact packaging, useful stage diagnostics, and adoption workflow. Do not copy PostgreSQL locking, hardcoded table names, path guessing, pool limits, or country seeding into a database-neutral core.

## Prinpo: direct push and a different driver

Source root: `/home/martini/Projects/prinpo/prinpo/`.

- `packages/db/src/index.ts`: `drizzle-orm/node-postgres`, native schema object, exported factory plus ordinary shared instance. Driver selection is independent of the SQL dialect.
- `packages/db/drizzle.config.ts`: native Kit config, schema directory, migrations output, dotenv tied to a particular app path.
- `packages/db/package.json`: push, generate, migrate, and Studio commands; root scripts forward through Turborepo. ORM `^0.45.2`, Kit `^0.31.10`, and `pg` are older than the target RC.
- Root `AGENTS.md`: rapid development deliberately uses schema changes and developer-run push without generating migrations. Available scripts do not imply migration-first is the actual development policy.

Extract native driver choice and familiar command names. Replace repeated env wrappers through Stack's existing profile/env machinery; do not make a checked-in migrations history a requirement for using Drizzle queries.

## Local SQL: embedded SQLite and executable packaging

Source root: `/home/martini/Projects/personal/local-sql/`.

- `apps/api/drizzle.config.ts`, `src/db/index.ts`: SQLite through libSQL, file location in an application-data directory with an override, beta ORM/Kit pins. This is a different dialect and driver from the other apps.
- `src/index.ts`: awaits `migrateDatabase()` during startup.
- `src/generate-migrations-imports-file.ts`: generates file imports for migrations, including metadata, for bundling.
- `src/db/migrate-database.ts`: writes bundled files to a temporary directory, invokes the native libSQL migrator, then removes them. A process-local boolean is set before migration succeeds, so it should not be copied as a retry or concurrency mechanism; cleanup is also outside a `finally`.
- `src/build.ts`: separate build/output packaging code illustrates why migration assets must be handled intentionally rather than assumed to follow bundled server imports.

Extract file-backed SQLite and startup migrations as simple lifecycle fixtures. Single-executable embedding and temporary extraction are a separate packaging feature, not automatically a requirement for Stack's current dist-based lifecycle.

## Betapoint Reports: schema ownership and disposable testing

Source root: `/home/martini/Projects/betapoint/betapoint-reports/`.

- `packages/database/drizzle.config.ts`, `src/index.ts`: PostgreSQL with Bun SQL and native relations, ORM/Kit manifests request `^1.0.0-rc.4`.
- `packages/database/package.json`: push orchestrates function preparation, schema push, function/view installation, and configuration seeding. These are domain-specific steps, not universal ORM lifecycle operations.
- `src/connection.ts`: explicit connection factory and caller ownership of closure; pool settings acknowledge long-running workload semantics. Avoid universal pool defaults based on another app's workload.
- ADR 0022 originally justified push for a disposable local database. ADR 0024 supersedes that disposability assumption: synchronized local data is persistent; tests require a separate marked disposable database and guarded mutation. A development profile is not evidence that data is disposable.
- Application-specific functions, views, and multiple schemas demonstrate the need for native SQL and an application-owned extension path beyond table generation.

## Shared patterns and proposed interview branches

These are proposals, not accepted decisions:

1. Own ORM and Kit versions centrally while keeping database dialect, runtime driver, and client options application-selected. Keep native schema/query/transaction types.
2. Separate using the Database Block from opting into managed migration lifecycle. Settle the intended integration boundary before choosing config files and import paths.
3. Support both explicit schema push for rapid iteration and versioned migrations for promotion. Decide separately whether development or production startup applies migrations automatically.
4. Establish failure and concurrency guarantees before promising automatic migrations on multiple production instances. Keep application startup blocked until its required preparation succeeds.
5. Define one migration artifact contract for credential-free builds and source-free startup. Do not infer deployed migrations from source paths or silently skip missing files.
6. Preserve structural offline doctor by default; discuss an explicit online diagnostic mode independently from mutation commands. Pending migration status and live schema drift are different checks.
7. Keep reference-data seeding, fixtures, backfills, database creation, reset, and adoption/baselining distinct. Decide which need Stack affordances and which stay native/application-owned.
8. Use file-backed SQLite tests for built lifecycle, migrations, repeat startup, failure-before-listen, asset packaging, profile selection, and optional absence. Those tests cannot establish PostgreSQL advisory lock or driver-specific transaction guarantees.
9. Resolve connection ownership, graceful shutdown, one-off CLI closure, and watch/restart behavior after settling the integration boundary.

Already requested by the developer: optional Block; ORM and Kit RC.5; no PostgreSQL/Bun SQL exclusivity; SQLite is suitable for lifecycle and automatic-production-migration tests. No implementation should start before the interview reaches confirmed shared understanding.
