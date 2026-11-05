# Database Block

Design interview in progress; implementation is not authorized until shared understanding is confirmed. [ADR 0016](../adr/0016-manage-one-database-with-mandatory-production-migrations.md) records the selected architectural boundary. Evidence: [reference applications](../research/database-app-patterns.md) and [exact RC.5 research](../research/drizzle-rc5.md).

## Settled requirements

- Optional Block, with exact Stack-owned ORM and Kit `1.0.0-rc.5` dependencies.
- Preserve native Drizzle APIs, dialect/driver selection, schema/relations, inferred types, and application client options. PostgreSQL and Bun SQL must not become mandatory choices.
- Native `drizzle.config.ts` owns Kit configuration. Do not duplicate dialect, schema paths, migration output, and connection settings in a parallel Stack configuration.
- Manage one database initially. Applications independently manage additional databases.
- Development performs no automatic database mutations. Developers explicitly push schema changes or generate/apply migrations as part of their development cycle.
- Production always applies committed migrations before accepting traffic when using the managed database lifecycle. No configurable skip or separate deployment-job mode in the initial version.
- Doctor remains offline and does not resolve credentials or connect to databases. Local migration counts are useful structural information; they are not a count of pending migrations in a live database.
- Database lifecycle tests use SQLite through **Bun SQL** (`drizzle-orm/bun-sql/sqlite`), not the synchronous `bun:sqlite` adapter. No PostgreSQL service is required. Verify Stack-owned orchestration, credential-free builds, artifact packaging, failure handling, and lifecycle behavior within that scope.
- Keep initial setup simple and almost configuration-free.

## Open design branches

- Capability detection and opt-in boundary; conventional config discovery.
- Native Kit subprocess versus application-selected runtime migrator for startup; compatibility with native configuration and independent Block use.
- Concurrent production starts and migration serialization. RC.5 does not supply a dedicated migration lock.
- Empty migration history, missing artifacts, and transition from schema push to committed migrations.
- CLI commands, native options, profiles, environment loading, and offline versus connected operations.
- Build packaging and manifest; source-free startup; migration/config paths independent of accidental working-directory assumptions.
- Startup integration, direct server startup, import ordering, connection ownership, graceful shutdown, and watch/restart behavior.
- Application-specific preparation, reference-data seeding, custom SQL, baselining, resets, and provisioning: initial scope versus application ownership.
- Logging, actionable failures, rollback/retry boundaries, and test acceptance scenarios.

## Interview record

Round 1: the developer selected the requirements above. SQLite qualification is specifically through Bun SQL. Production automatic migrations are mandatory rather than an opt-in policy with a separate-job alternative. Online doctor diagnostics are not included in the accepted requirement.
