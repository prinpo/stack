# Database Block

Stack owns exact `drizzle-orm@1.0.0-rc.5` and `drizzle-kit@1.0.0-rc.5` dependencies. Root `drizzle.config.ts` enables one managed database. Developers choose the dialect, runtime driver, schema, relations, and client options using native Drizzle APIs.

Initially import from `drizzle-orm/...` and `drizzle-kit` directly: a [temporary exception](adr/0017-retain-native-drizzle-import-paths-initially.md) to Stack's reexport policy. Native imports are qualified with Bun's hoisted installation; other package-manager layouts are not qualified. Install additional driver packages, such as `pg` or `mysql2`, in the application when needed.

## Setup

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

import { ENV } from "./src/env/server";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/database/schema.ts",
  out: "./migrations",
  dbCredentials: { url: ENV.DATABASE_URL },
});
```

Use exactly project-root `migrations/` and native `out: "./migrations"`. Configurable/profile-dependent migration directories are deferred. Keep config/schema modules free of connection or initialization side effects. Declare DATABASE_URL as a sensitive dynamic server setting in Varlock. Construct the runtime client in a separate application module imported after startup initialization.

For Bun SQL SQLite, pass a client created with `new SQL(ENV.DATABASE_URL)` to native `drizzle` from `drizzle-orm/bun-sql/sqlite`. This asynchronous adapter differs from synchronous `bun:sqlite`. A file URL such as `sqlite://app.sqlite` resolves from the application root.

```sh
stack db generate --name initial
stack db migrate
stack dev
```

Commit complete timestamped migration folders, including SQL and snapshots. The initial code-first migration creates the declared schema; it does not copy data or enroll an existing database previously created through `push`. Development never pushes, generates, or migrates automatically, including watched restarts. Apply schema changes explicitly. Moving an existing database from push to versioned migrations requires deliberate native baseline/reconciliation work outside this initial feature set.

## Commands and profiles

```sh
stack db generate --name add-notes
stack db generate --custom --name backfill-notes
stack db migrate --env staging
stack db push
stack db pull
stack db studio
stack db check
stack db up
stack db export
stack db migrate --help
```

Stack runs the installed Kit binary under Bun, never downloading tools. Native flags, prompts, help, output, and nonzero status pass through. Stack consumes `--env` for APP_ENV profile selection independently of NODE_ENV. Ordinary Kit drivers are auto-detected; installed external drivers can take precedence over Bun. The selectors `driver: "bun-sql"` and `driver: "bun:sqlite"` are not valid Kit configuration.

`generate`, `check`, `up`, and `export` load only static server configuration, without dynamic credentials. `migrate`, `push`, `pull`, and `studio` validate the selected server environment without importing the app. Help needs neither config nor environment resolution. Config modules must tolerate unresolved dynamic credentials for local operations and must not create connections eagerly.

`check` validates local history, not live drift. `up` converts old local migration formats, not pending database migrations. `pull --init` mutates migration history. `push --force` retains its native potentially destructive behavior. Stack adds no separate safety/repair engine.

## Build and production

Build fails if an enabled database has no migrations. It compiles config without evaluating it, copies complete migration folders under `dist/database`, and records database artifacts in the successful manifest. Builds need no runtime credentials, provider calls, or database connection.

Deploy built artifacts, installed Stack/Kit and required driver dependencies, and runtime environment schemas/configuration. Source config/schema/migration files are not required for production. Compiled config rebases the migration directory to the packaged location. Run lifecycle commands from the application root, as with other Stack workflows. Use runtime environment values for deployment-specific paths/credentials rather than deriving them from config source-file location.

Production validates environment, runs Kit `migrate`, imports the app, then opens its listener. This applies to `stack start`, direct Bun startup through `startServer`, and Stack's frontend-only production server when database support is enabled. CLI startup does not migrate twice. Built servers use manifest/artifacts without falling back to sources; missing advertised database artifacts are errors.

Automatic production migrations are mandatory. There is no disable flag or separate deployment-job mode. Kit is a production dependency; future image utilities may revisit its size. Failure/interruption prevents app import/listening and terminates the owned Kit process. Stack preserves native diagnostics and reports migration-stage context, without retry, repair, schema-push fallback, or rollback commands. A subsequent startup invokes the native migrator again.

Concurrent-start coordination is deferred. RC.5 has no dedicated migration lock; Stack does not guarantee safe simultaneous migrations by multiple starting instances. Native transaction guarantees vary by driver/dialect. PostgreSQL concurrent index creation, for example, cannot run inside the ordinary migration batch transaction. Keep applied migration files immutable: RC.5 selects pending migrations by name without ongoing checksum validation.

## Doctor, client ownership, and other drivers

Doctor reports database enablement, migration directory, and local SQL migration count. It never imports config, resolves credentials, connects, or launches Kit. Missing/empty migrations for an enabled database cause a nonzero exit explaining that development may continue but production build/start cannot. JSON includes the structured finding. Local count is not pending count. Missing optional database config is informational.

Applications construct and close their native clients. Stack owns only its Kit subprocess. The [full-stack example](../examples/fullstack/README.md) demonstrates persistent SQLite notes, an application-owned Bun SQL client, Elysia stop-hook cleanup, and signal handling. Stack adds no global cache or universal pool defaults.

For PostgreSQL/Bun SQL, select Kit dialect `postgresql`, use `pg-core` schema builders, provide a PostgreSQL DATABASE_URL, and construct runtime Drizzle through `drizzle-orm/bun-sql` with your Bun SQL client. No migration callback or driver registry is needed. Other drivers use native Drizzle adapters and application-installed dependencies. Additional databases remain application-managed.

Tests use SQLite through Bun SQL, not a PostgreSQL service; they qualify Stack orchestration rather than every driver/dialect. Provisioning/reset, seeding/fixtures, custom baseline/recovery, online diagnostics, live drift checks, configurable migration directories, and Docker/image utilities are deferred. Native custom SQL migrations and application scripts remain available.
