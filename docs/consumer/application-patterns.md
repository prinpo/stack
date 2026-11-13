---
title: Application structure and composition patterns
description: Use Stack's public interfaces, standalone application configuration, feature layout, and ownership conventions when creating or extending apps.
type: pattern
topics:
  - application-structure
  - dependencies
  - configuration
  - composition
  - generated-files
related:
  title: Related
  links:
    - capabilities.md
    - frontend.md
    - backend.md
    - eden-query.md
    - env.md
    - database.md
    - auth.md
    - cli.md
---

# Application structure and composition patterns

Use the applicable Stack Blocks and helpers before introducing a parallel integration. Stack preserves the native APIs of its selected libraries through `@prinpo/stack/...` imports. Applications own business rules, UI, authorization policy, notifications, and external services. Select capabilities according to the app; a frontend-only app can omit backend, database, and auth assembly.

These are reference conventions, not a scaffolding walkthrough. Use [the capability inventory](capabilities.md) to identify every relevant integration, then read its guide before writing configuration or feature code.

## Recommended layout

```text
app/
├── package.json
├── bunfig.toml
├── tsconfig.json
├── vite.config.ts
├── drizzle.config.ts           # only with a managed database
├── docker-compose.dev.yml      # only with local development services
├── env/
│   ├── client/.env.schema
│   └── server/.env.schema
├── migrations/                 # database migration SQL and snapshots
└── src/
    ├── index.html
    ├── main.tsx
    ├── client.ts               # typed API client, Query cache, provider
    ├── client/auth.ts          # optional auth client
    ├── env-gen/                # generated environment accessors
    ├── routeTree.gen.ts        # generated route tree
    ├── public/                # copied browser assets
    ├── routes/                # navigation, loaders, route layouts
    │   ├── __root.tsx
    │   └── notes.tsx
    ├── features/              # views and application feature logic
    │   └── notes/view.tsx
    └── server/
        ├── index.ts           # deferred, validated startup
        ├── app.ts             # Elysia composition and exported App type
        ├── routes/notes.ts
        ├── plugins/logging.ts
        ├── validation/notes.ts
        ├── database/
        │   ├── index.ts
        │   ├── schema.ts
        │   ├── relations.ts
        │   └── auth.generated.ts
        └── auth/
            ├── config.ts
            └── instance.ts
```

`src/index.html` and `src/server/index.ts` are the CLI's frontend/backend detection points. Generated environment modules must be inside `src/env-gen/`; tool configuration, environment schemas, and managed `migrations/` stay at the application root. Keep the standard outputs `dist/client/`, `dist/server/`, and `dist/manifest.json` for the CLI lifecycle. Remaining feature organization is recommended rather than enforced.

For an existing application, retain compatible feature organization. Change the required entry/configuration conventions and adopt the relevant Blocks without restructuring unrelated code. Backend-only applications omit the browser entry and frontend tooling. Frontend-only applications omit the server entry and API proxy.

## package.json

This complete full-stack manifest shows the tested toolchain for this Stack documentation. Replace `<stack-version>` with the installed or selected Stack version. Keep integrated runtime dependencies owned by Stack; install additional native drivers/providers only when the chosen integration requires them.

```json
{
  "name": "stack-application",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "stack dev",
    "build": "stack build",
    "start": "stack start",
    "check": "vp check"
  },
  "dependencies": {
    "@prinpo/stack": "<stack-version>",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  },
  "devDependencies": {
    "@types/bun": "1.4.4",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "typescript": "7.0.2",
    "vite": "npm:@voidzero-dev/vite-plus-core@1.2.0",
    "vite-plus": "1.2.0"
  },
  "overrides": {
    "vite": "npm:@voidzero-dev/vite-plus-core@1.2.0"
  },
  "devEngines": {
    "packageManager": {
      "name": "bun",
      "version": "1.4.4",
      "onFail": "download"
    }
  }
}
```

React and React DOM remain application-owned shared instances. Stack's `peerDependencies` describes the compatible ranges for the installed release. Vite+ and TypeScript are application-owned development tools. For later dependency upgrades, use a supported tested toolchain rather than treating the pinned versions in this reference as a universal compatibility promise.

The installed package exposes the ordinary local `stack` binary. Use package scripts above or `bunx --no-install stack <command>`; [CLI guidance](cli.md) covers operations and diagnosis. Direct Vite+ commands use the local toolchain through `bun --bun vp <command>`.

## bunfig.toml

Let Varlock own environment precedence even when commands run through Bun's package runner:

```toml
env = false
```

See [environment rules](env.md) for schema, profiles, and generated accessors. Keep secrets in server configuration; explicitly public client configuration is a separate graph.

## tsconfig.json

A standalone full-stack application can use:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "types": ["bun", "vite-plus/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["src", "vite.config.ts"]
}
```

Preserve `import type` boundaries so importing a server contract into browser code does not include server execution. [Frontend configuration](frontend.md) includes Vite, HTML, mounting, route generation, and Router registration.

## Compose by responsibility

| Concern          | Application pattern                                                                                                        | Stack integration                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Server startup   | `server/index.ts` dynamically imports `./app`; resource cleanup lives with resource ownership.                             | [Backend lifecycle](backend.md).                           |
| Server features  | Small native Elysia apps in `server/routes/`, assembled with `.use()` in `app.ts`. Export `App = typeof app`.              | [Backend route contracts](backend.md).                     |
| Input validation | Reusable schemas in `server/validation/`; derive persisted-model inputs where appropriate.                                 | [Database validation](database.md), native Elysia schemas. |
| Browser features | Route files declare loaders/navigation/layout; feature modules implement views and domain interactions.                    | [Frontend](frontend.md).                                   |
| API data         | One exported `createApiClient` result per browser app; components and route loaders reuse its options and cache.           | [Eden Query](eden-query.md).                               |
| Authentication   | Separate generation-safe config from runtime instance/helpers; mount server helpers and choose browser plugins explicitly. | [Auth](auth.md).                                           |
| Configuration    | Independent public client and secret server schemas; deferred startup precedes runtime module imports.                     | [Environment](env.md).                                     |
| Observability    | Reusable Elysia logging plugin; typed expected failures and a client guard; explicit browser development messages.         | [Logging](logger.md).                                      |

## Mutation behavior belongs to the application

Use native TanStack Query `MutationCache` callbacks for application-wide behavior, and endpoint `mutationOptions` callbacks or `meta` for operation-specific behavior. Stack supplies typed request/response integration and structured error recognition; applications choose user messages, translations, redirects, notifications, retry policies, and invalidation. Use the same QueryClient for mutation invalidation and route/component queries. See [queries and mutations](eden-query.md) for concrete APIs.

## Generated-file ownership

| File or directory                                                              | Owner and update mechanism                                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `src/routeTree.gen.ts`                                                         | Router generation through Stack's Vite preset during dev/build.                                                            |
| `src/env-gen/*`                                                                | Environment schema generator annotations and `stack env codegen`.                                                          |
| Configured auth schema, conventionally `src/server/database/auth.generated.ts` | `stack auth generate`; keep application-owned tables separate.                                                             |
| `migrations/`                                                                  | `stack db generate`; retain complete generated migration folders and snapshots. Apply through database lifecycle commands. |
| `dist/`                                                                        | Stack build; manifest and outputs are produced together on successful build.                                               |

Change source declarations or configuration, then regenerate rather than manually patching generated accessors/route trees/auth tables. Review generated SQL before applying migrations. Exclude generated TypeScript from formatting/lint rules where appropriate, while preserving the application's typechecking needs. [CLI](cli.md) explains check/generation commands and their completion signals.
