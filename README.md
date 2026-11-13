---
title: Prinpo Stack
description: Composable application Blocks and versioned Markdown documentation for agents, shipped together in one Bun package.
type: index
topics: [stack, installation, agents, documentation]
related:
  title: Documentation
  links: [docs/README.md, docs/capabilities.md, docs/application-patterns.md]
---

# @prinpo/stack

Stack is a thin application framework that composes Bun, Elysia, Eden, React, TanStack Router, TanStack Query, Varlock, Drizzle, Better Auth, and evlog through a shared public interface and documented patterns.

## Documentation for agents

Consumer documentation ships with the package. Point your application's `AGENTS.md` to its entry point:

```md
Before creating or changing application structure, frontend, backend, API queries,
environment, database, authentication, logging, or development/build workflows,
read node_modules/@prinpo/stack/docs/README.md and follow its task-specific links.
Use Stack's applicable Blocks, helpers, and CLI before implementing custom integration.
```

Start with the [documentation entry point](docs/README.md), [capability map](docs/capabilities.md), and [application patterns](docs/application-patterns.md). The references cover all Stack-owned helpers and operational CLI workflows; native APIs link to upstream documentation.

## Installation boundary

Stack requires Bun. Its CLI currently supports Linux. Stack owns its integrated library dependencies; UI applications install compatible React and React DOM peers, and applications own their Vite+ development tooling. Backend-only applications do not require React.

Use the application's installed executable with `bunx --no-install stack`, or from package scripts. See [application configuration](docs/application-patterns.md) for standalone manifests and [CLI workflows](docs/cli.md) for diagnostics, logs, schema operations, development, and builds.

Blocks remain independently composable wherever their underlying libraries allow. Applications own product UI, business rules, provider integrations, and deployment infrastructure.

## Attribution

The Eden Query connector is adapted from **eden-tanstack-react-query by Ilya Zhidkov and contributors**, under Apache-2.0. See [connector attribution and changes](src/eden-query/README.md) and [third-party notices](src/THIRD_PARTY_NOTICES.md).
