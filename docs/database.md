---
title: Database Block
description: Use Stack's Drizzle import paths, fixed migration configuration, application-owned clients, and managed database lifecycle.
type: reference
topics:
  - database
  - drizzle
  - migrations
  - sqlite
  - validation
related:
  title: Related
  links:
    - auth.md
    - cli.md
    - env.md
    - production.md
    - backend.md
---

# Database Block

Use this Block for native Drizzle queries, schema definitions, and a managed migration lifecycle. Stack owns exact `drizzle-orm@1.0.0-rc.5` and `drizzle-kit@1.0.0-rc.5` dependencies. A root `drizzle.config.ts` enables one managed database. Applications choose the dialect, runtime client, relations, and connection options; any additional databases remain application-managed.

## Public imports and upstream documentation

Stack preserves native ORM symbols and inference. Replace the `drizzle-orm` prefix with `@prinpo/stack/database` in upstream examples:

| Native import                           | Stack import                                     | Purpose                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle-orm`                           | `@prinpo/stack/database`                         | Operators such as `eq`/`sql`, `defineRelations`, inference types such as `InferSelectModel`. Also adds Stack's `defineConfig` and `DatabaseConfig`. |
| `drizzle-orm/sqlite-core`               | `@prinpo/stack/database/sqlite-core`             | SQLite table/column builders.                                                                                                                       |
| `drizzle-orm/pg-core`                   | `@prinpo/stack/database/pg-core`                 | PostgreSQL table/column builders.                                                                                                                   |
| `drizzle-orm/bun-sql/sqlite`            | `@prinpo/stack/database/bun-sql/sqlite`          | Qualified asynchronous Bun SQL SQLite adapter.                                                                                                      |
| `drizzle-orm/bun-sql`                   | `@prinpo/stack/database/bun-sql`                 | Bun SQL PostgreSQL adapter.                                                                                                                         |
| `drizzle-orm/bun-sql/sqlite/migrator`   | `@prinpo/stack/database/bun-sql/sqlite/migrator` | Native runtime migrator; the managed production lifecycle already invokes Kit migrations.                                                           |
| `drizzle-orm/zod`                       | `@prinpo/stack/database/zod`                     | Optional native table-derived Zod validation.                                                                                                       |
| Other published `drizzle-orm/<subpath>` | Matching `@prinpo/stack/database/<subpath>`      | Native dialects, drivers, validators, utilities, and types.                                                                                         |

Use the [official Drizzle reference](https://orm.drizzle.team/docs/overview) for native query/schema APIs and [relations documentation](https://orm.drizzle.team/docs/relations) for the `defineRelations` API. Match examples to the installed RC.5 release; earlier relational APIs can differ. Keep native `bun`/`bun:sqlite` imports for their respective application-owned clients.

Forwarding modules ship in the NPM package. Consumers need neither direct ORM dependency declarations nor forwarding generation. Imports remain separated by native subpath so common SQL helpers do not initialize all drivers/validators. Install external driver or validator dependencies only when the selected native integration requires them, such as `pg` or `mysql2`. Bun consumers are qualified; other package-manager layouts are not separately qualified.

## Stack-owned configuration

```ts
// drizzle.config.ts, at the application root
import { defineConfig } from "@prinpo/stack/database";

import { ENV } from "./src/env-gen/server";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/database/schema.ts",
  dbCredentials: { url: ENV.DATABASE_URL },
});
```

`DatabaseConfig` is native Kit configuration with the `out` field excluded. `defineConfig(config)` returns the native configuration plus immutable `out: "./migrations"`. It overrides an `out` arriving through a spread at runtime, and database commands reject `--out`. Keep one project-root `migrations/` directory across profiles.

Declare `DATABASE_URL` as a required, sensitive, dynamic setting in the server environment schema. A development SQLite value can be `sqlite://app.sqlite`; it resolves relative to the application root. See [environment configuration](env.md) for schema annotations and generated environment types.

Configuration and schema imports must remain free of live client creation or initialization side effects. Static operations and builds must tolerate unresolved dynamic credentials. Create the real client in a runtime module imported after `startServer` validates the environment.

## Schema, relations, and runtime client

Recommended module boundaries keep native declarations reusable by Kit and validators:

| Recommended file                        | Responsibility                              |
| --------------------------------------- | ------------------------------------------- |
| `src/server/database/schema.ts`         | Handwritten native tables and foreign keys. |
| `src/server/database/relations.ts`      | Native `defineRelations` declarations.      |
| `src/server/database/index.ts`          | Runtime client and Drizzle instance.        |
| `src/server/database/auth.generated.ts` | Optional generated auth tables/relations.   |

Existing applications may keep equivalent module locations; point `schema` at their declarations. Auth generation paths have their own CLI options.

```ts
// src/server/database/schema.ts
import { integer, sqliteTable, text } from "@prinpo/stack/database/sqlite-core";

export const notebooks = sqliteTable("notebooks", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
});
export const notes = sqliteTable("notes", {
  id: integer().primaryKey({ autoIncrement: true }),
  text: text().notNull(),
  notebookId: integer().references(() => notebooks.id),
});
```

```ts
// src/server/database/relations.ts
import { defineRelations } from "@prinpo/stack/database";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  notebooks: { notes: r.many.notes({ from: r.notebooks.id, to: r.notes.notebookId }) },
  notes: { notebook: r.one.notebooks({ from: r.notes.notebookId, to: r.notebooks.id }) },
}));
```

```ts
// src/server/database/index.ts
import { drizzle } from "@prinpo/stack/database/bun-sql/sqlite";
import { SQL } from "bun";

import { ENV } from "../../env-gen/server";
import { relations } from "./relations";

export const client = new SQL(ENV.DATABASE_URL);
export const db = drizzle({ client, relations });
```

This is the asynchronous Bun SQL adapter, distinct from synchronous `bun:sqlite`. Query with native APIs, for example `await db.query.notebooks.findMany({ with: { notes: true } })`. Table foreign keys and relational query declarations have separate native responsibilities.

With the Auth Block, include generated tables in Kit's `schema` list and merge `authRelations` into runtime relations; see [auth database integration](auth.md). Keep handwritten code outside generated files.

Applications construct and close native clients. Stack adds no global database cache or universal pool settings. Close the client through an Elysia `onStop` hook or Stack's shutdown callback; see [shutdown and resource ownership](backend.md#shutdown-and-resource-ownership) for the canonical implementation, signal handling, and failure behavior.

## Migration ownership and diagnostic boundaries

Use [CLI database operations](cli.md) for generation, review, application, inspection, and profiles. The CLI runs installed Kit under Bun and retains native flags/help/output, with Stack owning the migration output directory and `--env` profile handling.

Commit complete timestamped migration folders, including SQL and snapshots. Review generated SQL before applying it. Development, including watched restarts, never automatically generates, migrates, or pushes a schema. Auth schema generation and SQL migration generation are separate operations.

| Operation                           | Configuration and effect                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `generate`, `check`, `up`, `export` | Static server configuration; no dynamic credentials or database connection.              |
| `migrate`, `push`, `pull`, `studio` | Validated selected server environment; database-connected native operation.              |
| `doctor`                            | Structural inspection only; no config import, credentials, connection, or Kit execution. |

`check` checks local migration history rather than live drift. `up` converts old local migration formats rather than applying pending migrations. `doctor` reports local migration count, not pending count. Enabled database support with missing/empty migrations fails doctor and blocks production build/start; development can still run.

An initial code-first migration creates tables; it does not enroll a database previously created with `push` or copy its data. Adopt existing databases through deliberate native baseline/reconciliation work. Native custom SQL migrations remain available for application-owned backfills. `pull --init` changes local migration history, and `push --force` retains its native destructive semantics.

## Build and production contract

Build compiles the config without evaluating it, copies complete migration folders under `dist/database`, and records the artifacts in the successful manifest. It needs no live database, runtime credentials, or provider calls. An enabled managed database must have migrations before build.

Production validates the environment, runs Kit `migrate`, imports the application, then listens. This gate applies to `stack start`, direct production startup through `startServer`, and Stack's frontend-only production server with database configuration. CLI startup does not migrate twice. Automatic migrations are mandatory; there is no disable flag or separate deployment-job mode.

Deploy built artifacts, installed Stack/Kit and selected external drivers, and runtime environment schemas/configuration. Source config/schema/migration files are unnecessary after build; compiled config rebases migration paths to the packaged directory. Run from the application root and derive deployment-specific paths from runtime configuration. Missing manifest-advertised database artifacts are errors. See [production lifecycle](production.md) for the full deployment contract.

Migration failure/interruption prevents app import/listening and stops the owned Kit process. Stack preserves native diagnostics without automatic retry, repair, rollback, or schema-push fallback. A subsequent startup runs the native migrator again.

Multi-instance migration coordination remains application-owned. Stack does not guarantee safe concurrent migrations by simultaneous starts; serialize rollout where required. RC.5 has no dedicated migration lock, transaction guarantees differ by dialect/driver, and applied migrations must remain immutable: pending selection uses names rather than ongoing checksum validation.

## Optional table-derived validation

Use native Drizzle Zod utilities through `@prinpo/stack/database/zod`; no separate `drizzle-zod` dependency is needed. Stack includes Zod, and core database imports do not load the validator integration.

```ts
// src/server/validation/notebooks.ts
import { createInsertSchema } from "@prinpo/stack/database/zod";

import { notebooks } from "../database/schema";

export const createNotebookBody = createInsertSchema(notebooks, {
  name: (schema) => schema.trim().min(1).max(100),
}).pick({ name: true });
```

Pass the schema directly to an Elysia route's `body` option. Standard Schema validation transforms input, rejects invalid names, and excludes caller-supplied IDs. Explicitly select API fields and add refinements; database metadata does not establish authorization, uniqueness handling, or business rules. Import table declarations, never the runtime connection, when constructing validators. Native Elysia TypeBox validation remains available for other payloads.

## Driver choices and limits

SQLite through Bun SQL is the qualified baseline for orchestration, package installation, and automatic production migrations. For PostgreSQL/Bun SQL, choose Kit dialect `postgresql`, use `pg-core` builders and a PostgreSQL URL, and import runtime `drizzle` from `@prinpo/stack/database/bun-sql`. Use native Kit driver auto-detection: `driver: "bun-sql"` and `driver: "bun:sqlite"` are not valid Kit configuration selectors. Other installed native drivers can take precedence over Bun.

Other adapters stay available through matching ORM subpaths, with required external dependencies installed by the application. Their availability is not a qualification claim for every dialect/driver. Provisioning/reset, seeding/fixtures, baseline/recovery, live drift checks, custom migration directories, additional databases, and deployment migration coordination remain native/application concerns.
