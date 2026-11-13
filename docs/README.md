---
title: Stack documentation for agents
description: Find Stack capabilities, application conventions, and task-specific references before implementing an application.
type: index
topics: [agents, documentation, capabilities, conventions]
related:
  title: Read by task
  links: [capabilities.md, application-patterns.md, cli.md]
---

# Stack documentation for agents

Stack composes native libraries through `@prinpo/stack/...` imports and adds integration helpers. Use its applicable Blocks, utilities, and CLI workflows before writing application-specific integration code. Applications choose the capabilities they need and own product behavior, UI, and policies.

## Application AGENTS.md pointer

Copy this into the consuming application's `AGENTS.md`:

```md
Before creating or changing application structure, frontend, backend, API queries,
environment, database, authentication, logging, or development/build workflows,
read node_modules/@prinpo/stack/docs/README.md and follow its task-specific links.
Use Stack's applicable Blocks, helpers, and CLI before implementing custom integration.
```

## Read by task

| Task                                                                       | Read                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Discover supported Blocks, utilities, and import paths                     | [Capability map](capabilities.md)               |
| Create application files or decide where code belongs                      | [Application patterns](application-patterns.md) |
| Render React, add file routes, configure Vite or devtools                  | [Frontend](frontend.md)                         |
| Define Elysia routes, validation, server startup, typed Eden calls         | [Backend](backend.md)                           |
| Fetch/cache API data, mutate, paginate, preload in loaders                 | [Eden Query](eden-query.md)                     |
| Configure schemas, generated types, static/dynamic public values           | [Environment](env.md)                           |
| Define tables, select a driver, configure migrations                       | [Database](database.md)                         |
| Add login, sessions, organizations, invitations, delivery                  | [Authentication](auth.md)                       |
| Log requests, return structured errors, broadcast development messages     | [Logging](logger.md)                            |
| Diagnose problems, retrieve logs, generate/check migrations or auth schema | [CLI workflows](cli.md)                         |
| Run development, Compose dependencies, proxy and browser tools             | [Development](development.md)                   |
| Build, deploy, configure runtime values, migrate, stop cleanly             | [Production](production.md)                     |

## Essential conventions

- Import integrated libraries through Stack. React and React DOM are application-owned peers; Bun and Vite+ are application tooling. Optional drivers/providers may need application dependencies.
- Preserve native APIs and inferred types. Consult the relevant capability guide for Stack's additions and upstream references.
- Use the documented structure for new apps. In existing apps, preserve compatible organization and apply the required entry/configuration conventions.
- Keep server modules out of browser runtime imports; import the Elysia contract with `import type`.
- Use the installed local CLI. Run commands from the application root; read [CLI workflows](cli.md) before diagnostics or schema operations.
- This documentation ships with the installed Stack version. Use it as the integration reference for that version; upstream examples may target a different version.

Each guide has YAML metadata: `title`, `description`, `type`, `topics`, and relative `related.links`. Follow the Markdown links directly; no documentation server or sidebar is required.
