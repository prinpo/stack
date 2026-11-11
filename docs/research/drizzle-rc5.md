# Drizzle ORM and Kit 1.0.0-rc.5 research

Inspected **2026-11-05**. Scope: evidence for an optional Stack database Block, not an implementation or architecture decision. Read root agent instructions, coding standards, glossary, and ADRs 0001, 0002, 0003 and 0010. No application inspection, dependency changes, secret-file reads, or database connections. Downloaded published tarballs and the pinned upstream source into `/tmp/stack-drizzle-rc5-research`; inspected them statically. No runtime integration tests were executed.

## Version and evidence boundary

- **Both exact versions exist:** `drizzle-orm@1.0.0-rc.5` (published 2026-10-21 17:59:58 UTC) and `drizzle-kit@1.0.0-rc.5` (18:01:51 UTC). Keep both exact pins as requested; do not substitute `@latest`, `@rc`, or a hash-suffixed prerelease. Observed registry tags: ORM `latest=0.45.4`, Kit `latest=0.31.11`, both `rc=1.0.0-rc.5`, both `rc5=1.0.0-rc.5-5935859`. Tags are mutable; the suffixed build is a distinct version. Kit rc.5 declares peer `drizzle-orm >=1.0.0-rc.5`. ([ORM registry](https://registry.npmjs.org/drizzle-orm), [Kit registry](https://registry.npmjs.org/drizzle-kit), [Kit exact metadata](https://registry.npmjs.org/drizzle-kit/1.0.0-rc.5).)
- Downloaded **both exact tarballs** and verified their bytes against registry SHA-1 and SHA-512 integrity values. SHA-1: ORM `641cadbb9737c46ad1428d3b987bda2f3e9a9bfe`; Kit `3deccb55a0fae718a4d6c86d817628106d57401c`. These are artifact checks, not independent signature verification. ([ORM tarball](https://registry.npmjs.org/drizzle-orm/-/drizzle-orm-1.0.0-rc.5.tgz), [Kit tarball](https://registry.npmjs.org/drizzle-kit/-/drizzle-kit-1.0.0-rc.5.tgz).)
- Git tag `v1.0.0-rc.5` resolves to **`5d71fc408add08bd207f4753f4554578ec9e0640`**. ORM npm provenance names the same commit; exact metadata has no `gitHead`. Source links below pin that commit and were cross-checked against the shipped declarations/JavaScript for the key APIs and migration paths. ([Tag API](https://api.github.com/repos/drizzle-team/drizzle-orm/git/ref/tags/v1.0.0-rc.5), [ORM provenance](https://registry.npmjs.org/-/npm/v1/attestations/drizzle-orm@1.0.0-rc.5).)
- **Official website pages are moving/latest guidance, not rc.5 specifications.** In particular, today's v1 page advertises a root programmatic SDK absent from the rc.5 root exports, and says `push --strict` is removed while rc.5 still declares the flag. Prefer the tarball and pinned source for compatibility decisions. ([Moving v1 guide](https://orm.drizzle.team/docs/v0-v1-changes), [rc.5 root exports][kit-index], [rc.5 CLI schema][cli].)

## Dialects and Bun drivers

Kit rc.5's configuration type lists `postgresql`, `mysql`, `sqlite`, `turso`, `singlestore`, `mssql`, `cockroach`, and `duckdb`; this is not a guarantee that every command supports every dialect. Runtime ORM adapters include PostgreSQL (`pg`, postgres.js, Bun SQL, Neon, PGlite, AWS Data API), MySQL (`mysql2`, PlanetScale, Bun SQL), SQLite (`bun:sqlite`, Bun SQL, better-sqlite3, node:sqlite, libSQL, D1, Expo and others), plus specialized dialect/adapters. Choose dialect and driver explicitly for a Block's support contract rather than exposing a supposedly interchangeable database. ([Kit types][kit-index], [ORM adapter source tree](https://github.com/drizzle-team/drizzle-orm/tree/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src).)

| Target                     | Exact rc.5 runtime API                                                                                                                                                                                       | Kit connection behavior                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL through Bun SQL | `drizzle` from `drizzle-orm/bun-sql` defaults to PostgreSQL; explicit `drizzle.postgres` or `drizzle-orm/bun-sql/postgres` also exists. Accepts URL or `{ client: new SQL(...) }`; result retains `$client`. | `dialect: 'postgresql'`, `dbCredentials: { url }`; omit `driver`. Kit detects installed drivers and has a native Bun branch.                             |
| Synchronous Bun SQLite     | `drizzle` from `drizzle-orm/bun-sqlite`, `{ client: new Database(...) }` from `bun:sqlite`; `.all()`, `.get()`, `.values()`, `.run()` and synchronous transaction callbacks.                                 | `dialect: 'sqlite'`, `dbCredentials: { url: './db.sqlite' }`; omit `driver`. Kit's Bun branch uses **Bun SQL SQLite**, not the `bun:sqlite` ORM adapter. |
| Bun SQL SQLite/MySQL       | Separate `drizzle.sqlite` / `drizzle.mysql` namespaces and `bun-sql/sqlite` / `bun-sql/mysql` imports. These differ from the default PostgreSQL adapter and from synchronous `bun:sqlite`.                   | Native Bun SQL branches exist for these dialects too.                                                                                                    |

Sources: [Bun dispatch][bun-driver], [PostgreSQL adapter][bun-pg], [synchronous SQLite adapter][bun-sqlite], [Kit connections][connections]. The website has useful but unpinned [Bun SQL](https://orm.drizzle.team/docs/connect-bun-sql) and [Bun SQLite](https://orm.drizzle.team/docs/sqlite/connect-bun-sqlite) examples.

`driver: 'bun-sql'` and `driver: 'bun:sqlite'` are **not valid Kit rc.5 config selectors**. Special selectors cover providers such as `pglite`, `aws-data-api`, `dsql`, `d1-http`, `expo`, `durable-sqlite`, and `sqlite-cloud`. Ordinary connections use auto-detection; installed third-party drivers can win before Bun. Execute Kit with Bun explicitly (for example, the already-installed binary under `bun --bun`) if relying on its native branch. Do not infer a verified minimum Bun version: rc.5 declares no engine minimum, and Kit's async SQLite path needs more than historical PostgreSQL-only Bun SQL support. Exact Stack Bun compatibility remains to be probed. ([Config types][kit-index], [detection order][connections].)

## Schema, relations, and type exports

- Common operators (`sql`, `eq`, `and`, etc.), table/model utilities, and the new `defineRelations` / `defineRelationsPart` are root ORM exports. Dialect builders remain under `pg-core`, `sqlite-core`, `mysql-core`, etc.; driver constructors and native database types remain under driver entry points. Preserve upstream generics and dialect-specific names. ([Root][orm-index], [relations][relations], [table inference][table].)
- rc.5 relational queries use **`relations` in `drizzle({ client, relations })`**, built with `defineRelations(schema, r => ...)`. `schema` is not a property of the current common `DrizzleConfig`; copying a 0.x `drizzle({ schema })` example is wrong for this API. Legacy relations code still exists under `_relations` for internal/tooling uses; its physical presence is not the current public query contract. ([Common config][orm-utils], [relations][relations], [driver][bun-pg].)
- Native inference includes `typeof users.$inferSelect`, `typeof users.$inferInsert`, `InferSelectModel`, and `InferInsertModel`; no generated client is needed. Relations used to shape queries do not replace table-level foreign-key DDL. Keep runtime table/relations exports separate from type-only application imports when useful. ([Model types][table], [relation builder][relations], [PostgreSQL foreign keys][pg-fk].)
- Validation integrations are separate subpaths such as `drizzle-orm/zod`, `valibot`, `typebox`, `arktype` and `effect-schema`, with their respective peers; reexporting every integration can expand dependency/type requirements. ORM's package has optional driver/validator peers and no ordinary dependencies. ([Exact ORM manifest](https://registry.npmjs.org/drizzle-orm/1.0.0-rc.5).)

## Kit configuration and workflow

Use native `defineConfig` / `Config` from `drizzle-kit`. rc.5 supports `dialect`, schema path/glob or array, `out` (default `drizzle`), dialect credentials, `migrations: { table, schema }`, `schemaFilter`, `tablesFilter`, `extensionsFilters`, `entities`, `introspect.casing`, `breakpoints` and `verbose`. Schema files must export the declarations Kit should discover. Commands needing a database read credentials; generation itself does not need a database, although importing an application-owned schema/config can execute arbitrary module side effects. ([Exact config and JSDoc][kit-index], [configuration preparation][command-utils], [moving config guide](https://orm.drizzle.team/docs/drizzle-config-file).)

| Command    | Purpose and boundary verified in rc.5                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate` | Diff exported schema against migration snapshots; write SQL and snapshot. `--name`, `--custom`, `--explain`, `--output json`, `--hints` / `--hints-file` exist. `--custom` produces an empty SQL migration for hand-written DDL/data work; it cannot be combined with `--explain`. Review SQL before applying it.                                             |
| `migrate`  | Check local migration history first, connect using Kit's selected adapter, then invoke the ORM runtime migrator. Needs `out`, dialect and connection configuration; source schema is not needed for executing SQL. This preflight is additional to the runtime API.                                                                                           |
| `push`     | Introspect the live database and apply the schema diff directly; does not produce the versioned migration history of `generate`. `--explain` is dry-run planning; `--force` approves potential data loss. rc.5 still has `--strict`. Its PostgreSQL push application loops through queries; do not borrow the runtime migrator's batch-transaction guarantee. |
| `pull`     | Introspection: write TypeScript schema/relations files and migration snapshot/SQL artifacts from an existing database. Normal generated initial SQL is commented out. `--init` additionally records a baseline in the database, so it is not a read-only operation.                                                                                           |
| `check`    | Validate local snapshots/history and branch conflicts; not a live database drift check and not a database concurrency lock. PostgreSQL can report schema mismatch or failure-to-compare as **warnings**, so a successful check is not proof schema and history match.                                                                                         |
| `up`       | Upgrade old local migration layout/snapshot formats; does not mean apply pending application migrations. PostgreSQL validates/converts snapshots before moving files; do not generalize its file-failure behavior to every dialect or filesystem failure.                                                                                                     |
| `studio`   | Start the database browsing/editing proxy; default `127.0.0.1:4983`, browser UI at `local.drizzle.studio`. Separate operational command from starting the application. Schema/credentials can be supplied in config; it is not an embedded application admin UI.                                                                                              |
| `export`   | Produce DDL from the schema without applying it.                                                                                                                                                                                                                                                                                                              |

Exact sources: [CLI commands/options][cli], [PostgreSQL generation][generate-pg], [artifact writer][generate-common], [PostgreSQL push][push-pg], [local check][check], [PostgreSQL check warnings][check-pg], [PostgreSQL up][up-pg]. General online introductions: [Kit overview](https://orm.drizzle.team/docs/kit-overview), [pull](https://orm.drizzle.team/docs/drizzle-kit-pull), [Studio](https://orm.drizzle.team/docs/drizzle-kit-studio).

For a reviewed migration workflow: edit schema → `generate` → review/commit the complete migration folders → `check` → apply with Kit or a dedicated runtime migration job. Database-first work starts with `pull`; local prototyping can use `push`. Avoid alternating `push` and versioned migrations against the same database without an explicit baseline/reconciliation process. This is a workflow recommendation, not an upstream enforced restriction. Stack CLI ownership fits [ADR 0010](../adr/0010-own-application-commands-through-the-stack-cli.md); exact command names/config conventions remain a design decision.

## rc.5 migration files and deployment packaging

The v3 layout is `out/YYYYMMDDHHmmss_name/{migration.sql,snapshot.json}`, with UTC time prefixes, replacing `meta/_journal.json`. PostgreSQL's rc.5 snapshot format is **9**, using an initial base plus later diffs, IDs/parent IDs and footprints/deltas to reason about branches; snapshot versions are dialect-specific. Keep complete folders in source control for future generation/checking/upgrades. ([Writer][generate-common], [PostgreSQL snapshot production][generate-pg], [snapshot definitions][snapshot-pg].)

The runtime reader only needs the migration directory names and their **`migration.sql` files**: it scans direct children, filters entries with that filename, sorts names lexicographically, splits SQL on `--> statement-breakpoint`, derives UTC timestamps, and calculates SHA-256. It does not consult snapshots or a generated JS journal for its filesystem path. It rejects a legacy `meta/_journal.json` and asks for `drizzle-kit up`. ([Exact reader][reader], [timestamp/order utilities][migration-utils].)

Runtime examples (illustrative upstream APIs, no proposed Stack wrapper):

```ts
// PostgreSQL / Bun SQL: asynchronous
import { migrate } from "drizzle-orm/bun-sql/migrator";
await migrate(db, {
  migrationsFolder: "/absolute/deployment/path/drizzle",
  migrationsTable: "__drizzle_migrations",
  migrationsSchema: "drizzle",
});

// bun:sqlite: synchronous; db here is a different adapter instance
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
migrateSqlite(sqliteDb, { migrationsFolder: "/absolute/deployment/path/drizzle" });
```

The PostgreSQL filesystem migrator takes `MigrationConfig`; Bun SQLite additionally accepts a `MigrationsJournal` array `{ sql, timestamp, name }[]` or `{ migrationsJournal, migrationsTable? }`. The SQLite journal path uses an empty hash. Kit's optional `migrations.js` bundles SQL imports for Expo/Durable Objects; its `{ migrations: ... }` output is **not** the Bun SQLite journal input. Do not assume every driver accepts an embedded journal. ([PostgreSQL entry][pg-migrator], [Bun SQLite entry][sqlite-migrator], [migration types][migration-types], [Kit embedded writer][generate-common].)

**Deployment implication:** bundling backend JavaScript does not automatically ship files read with `fs.readdirSync/readFileSync`. Copy migration assets explicitly and resolve a stable path independent of process working directory, or deliberately implement/test a supported journal packaging path. A production runtime migration job can use ORM plus the native driver without shipping Kit or schema TypeScript. Kit generation/introspection needs the appropriate config/schema/dependencies in its environment. These are deductions from the reader and CLI, not executed packaging validation. ([Reader][reader], [CLI][cli].)

## Migration engine guarantees: verified limits

| Property            | Exact rc.5 PostgreSQL / Bun SQL and synchronous Bun SQLite evidence                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Metadata            | Default table `__drizzle_migrations`; PostgreSQL schema **`drizzle`**. Columns `id`, `hash`, `created_at`, `name`, `applied_at`. PostgreSQL uses serial PK and timestamptz default `now()`; SQLite integer PK and text applied timestamp. No migration status/failed flag or unique constraint on name/hash. Some moving config docs describe `public`; the executable source defaults to `drizzle`.                     |
| Pending selection   | Compare local names against recorded database names. It does **not** merely use the latest timestamp. An older-named missing migration can run. Renaming an applied folder makes it look new; editing SQL under an applied name is skipped. Hash storage does not imply ongoing checksum validation.                                                                                                                     |
| Transaction unit    | PostgreSQL executes all selected migrations and their log inserts in one `db.transaction`; the Bun adapter delegates to `SQL.begin`. Sync SQLite runs `BEGIN`, all pending statements/inserts, then `COMMIT`; it attempts `ROLLBACK` and rethrows on error. Not one transaction per migration.                                                                                                                           |
| Setup boundary      | Schema/table creation, metadata-shape detection/upgrade and pending selection happen **before** the main pending batch transaction. Legacy table upgrade has its own transaction path. Therefore failure need not leave the entire database byte-for-byte untouched.                                                                                                                                                     |
| Locking/concurrency | No explicit advisory lock, migration lock row, `SELECT ... FOR UPDATE`, or atomic name claim in these paths. Reads happen before the batch transaction. Ordinary DDL/SQLite write locks are not an exactly-once protocol. Two migrators can select the same pending work; duplicate execution/errors are possible. Use one externally serialized deployment migration job unless a separately designed lock is verified. |
| Failure/retry       | For transactional statements under a healthy connection, the batch structure intends rollback of the pending SQL and bookkeeping together. No automatic down-migration, repair, retry, or durable failure record is provided here. Disconnect at commit has an uncertain outcome until database history is re-read. SQL that manages its own transactions or has external effects weakens any guarantee.                 |

Sources: [PostgreSQL migration implementation][pg-session], [SQLite implementations][sqlite-session], [pending-name filter][migration-utils], [Bun transaction adapter][bun-session], [PostgreSQL old-table upgrade][pg-upgrade], [SQLite old-table upgrade][sqlite-upgrade]. These are source-derived guarantees/limitations, **not executed failure or concurrency tests**.

`CREATE INDEX CONCURRENTLY` cannot run inside a PostgreSQL transaction block. rc.5's PostgreSQL `MigrationConfig` exposes no general transaction opt-out, so this operation needs an explicitly designed external/nontransactional migration procedure; do not promise that arbitrary hand-written SQL works in the standard batch. Other drivers/dialects have different transaction mechanisms and cannot inherit the two adapters' guarantees. ([Config type][migration-types], [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html).)

On first use against an old bookkeeping table, rc.5 matches old rows to local migrations using rounded timestamps and hashes, backfills names, and adds applied timestamps (old rows become NULL). It can fail if historical local migrations are missing/unmatchable. This automatic database metadata upgrade is separate from `kit up`'s local-file conversion. Preserve old migration history and test upgrades against a disposable copy. ([PG upgrade][pg-upgrade], [SQLite upgrade][sqlite-upgrade].)

## Programmatic Kit: supported surface versus internals

rc.5 **does expose selected package subpaths**, but not today's general root SDK:

- Root `drizzle-kit`: runtime `defineConfig`, config types. No root `generate`, `migrate`, `push`, `pull`, `check`, or `exportSql` SDK functions.
- `drizzle-kit/api-postgres`: exported `generateDrizzleJson`, `generateMigration`, `pushSchema`, `reconstruct`, `up`, `startStudioServer`, plus hint/error types. These are public package exports, but the signatures operate on snapshots/schema states and native instances, not a uniform CLI configuration API. Some error paths call `process.exit`; embedding requires care.
- `api-mysql` and `api-sqlite`: shipped declarations expose **only `startStudioServer`**. Do not assume API parity from the PostgreSQL surface.
- `drizzle-kit/cli` and `payload/{postgres,mysql,sqlite,mssql}` are exported too. CLI internals and hashed chunk filenames are not a stable service API; importing a CLI entry is not equivalent to calling an embeddable function. No support claim for reaching into unpublished source paths.

Evidence: [exact package export map][kit-package], [root][kit-index], [PostgreSQL API source][api-pg], [MySQL API][api-mysql], [SQLite API][api-sqlite]. By contrast, the [moving v1 guide](https://orm.drizzle.team/docs/v0-v1-changes) advertises a later root SDK. **For rc.5, CLI subprocess delegation is the broadest common Kit integration surface**; runtime migration APIs are available independently in ORM. No claim of long-term semver stability is justified for these prerelease APIs.

## Testing boundary and unresolved checks

SQLite can validate its own Block lifecycle, basic CRUD, migration file packaging, and failure handling. It cannot establish PostgreSQL correctness: SQL/DDL, native enums/arrays/JSONB, schemas/RLS, timestamp/numeric codecs, server connections, pooling, isolation and concurrent deployment behavior differ. SQLite's flexible typing and boolean/date representation can mask bugs; explicitly verify foreign-key enforcement on each test connection. ([SQLite quirks](https://www.sqlite.org/quirks.html), [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html), [dialect-specific source](https://github.com/drizzle-team/drizzle-orm/tree/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/pg-core).)

Before promising Stack support, use disposable databases to verify:

1. Exact Stack Bun version with both ORM adapters and Kit's different SQLite path; native driver auto-selection, URL/TLS handling, shutdown and connection cleanup.
2. PostgreSQL generated SQL from empty schema and upgrades, type inference/relations, and schema-module imports through proposed Stack reexports; ensure Kit still discovers table declarations.
3. Production bundle plus copied migration assets from a different working directory; CLI/config loading through Stack's environment lifecycle without accidental app startup.
4. Multiple pending migrations with an injected later failure; metadata creation versus batch rollback; retry; old journal/table upgrade; concurrent starts; disconnect/commit uncertainty. This research did not execute these cases.
5. PostgreSQL branch/conflict workflows, custom data migrations and drift policy. Local `check` does not inspect live drift or prove arbitrary custom SQL commutes.
6. Whether an optional Block includes only PostgreSQL/Bun SQL initially or also synchronous SQLite; who runs migrations and serializes deployments; whether Kit config stays native or Stack generates/adapts it. Parent design work owns these choices.

No existing ADR must change merely to research this Block. A future integration should preserve independent/native APIs ([ADR 0002](../adr/0002-compose-independent-blocks-with-native-apis.md)), exact Stack-owned pins ([ADR 0001](../adr/0001-stack-owns-library-dependencies.md)), and CLI ownership; database work explicitly deferred in those ADRs needs a new scoped decision before implementation.

[kit-index]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/index.ts
[kit-package]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/package.json
[cli]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/schema.ts
[connections]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/connections.ts
[bun-driver]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/bun-sql/driver.ts
[bun-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/bun-sql/postgres/driver.ts
[bun-sqlite]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/bun-sqlite/driver.ts
[orm-index]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/index.ts
[relations]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/relations.ts
[table]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/table.ts
[orm-utils]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/utils.ts
[pg-fk]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/pg-core/foreign-keys.ts
[command-utils]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/utils.ts
[generate-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/generate-postgres.ts
[generate-common]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/generate-common.ts
[push-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/push-postgres.ts
[check]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/check.ts
[check-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/check-postgres.ts
[up-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/cli/commands/up-postgres.ts
[snapshot-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/dialects/postgres/snapshot.ts
[reader]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/migrator.ts
[migration-utils]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/migrator.utils.ts
[pg-migrator]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/bun-sql/postgres/migrator.ts
[sqlite-migrator]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/bun-sqlite/migrator.ts
[migration-types]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/migrator.ts
[pg-session]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/pg-core/async/session.ts
[sqlite-session]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/sqlite-core/async/session.ts
[bun-session]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/bun-sql/postgres/session.ts
[pg-upgrade]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/up-migrations/pg.ts
[sqlite-upgrade]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-orm/src/up-migrations/sqlite.ts
[api-pg]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/ext/api-postgres.ts
[api-mysql]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/ext/api-mysql.ts
[api-sqlite]: https://github.com/drizzle-team/drizzle-orm/blob/5d71fc408add08bd207f4753f4554578ec9e0640/drizzle-kit/src/ext/api-sqlite.ts
