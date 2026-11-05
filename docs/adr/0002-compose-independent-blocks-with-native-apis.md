# Compose independent blocks with native APIs

Stack serves full-stack, frontend-only, and potentially backend-only applications through composable blocks. It preserves the underlying libraries' native concepts and types, reexported through `@prinpo/stack/...`; abstractions are justified when they eliminate configuration files, setup, or other repeated work. Blocks introduce no artificial prerequisites beyond what their underlying integrations require.

Application structure remains flexible. Document recommended layouts and patterns so humans and agents can build consistent applications, without enforcing a directory structure or providing scaffold templates or generators.

The first milestone focuses on a full-stack application using Bun, TanStack Router, router devtools, Elysia, and Eden. Frontend-only use follows by omitting the backend integration. TanStack Query, database, authentication, logging, and environment integrations are deferred. Server-side rendering is outside the current scope.

The initial public paths are `@prinpo/stack/server` for Elysia and the production serving helper, `@prinpo/stack/client` for Eden, `@prinpo/stack/react` for TanStack Router, `@prinpo/stack/devtools` for router devtools, and `@prinpo/stack/vite` for browser tooling. Preserve native export names and keep browser entry points free of server runtime imports. React and React DOM retain their upstream import paths.

Standard Stack server startup now composes Varlock configuration by default: `startServer` validates owned connection settings and independent app/client schemas before importing application modules. This is an intentional exception to optional Block assembly for the standard full-stack lifecycle. Native Elysia exports retain their types and do not initialize configuration merely on import; lower-level serving and environment helpers remain independently usable.

[ADR 0016](0016-manage-one-database-with-mandatory-production-migrations.md) brings the optional Database Block into scope, including mandatory production migrations when root `drizzle.config.ts` enables the capability. [ADR 0017](0017-retain-native-drizzle-import-paths-initially.md) records its temporary exception to Stack reexports: database code initially uses native ORM/Kit import paths while Stack owns the pinned dependencies.
