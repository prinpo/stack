# @prinpo/stack

Stack is a thin application framework that composes Bun, Elysia, Eden, React, TanStack Router, TanStack Query, Varlock, Drizzle, Better Auth, and evlog through a shared public interface and documented patterns.

## Installation

With Bun installed, run these steps from your application's directory. If you're starting with an empty directory, run `bun init -y` first.

1. **Install Vite+ locally.**

   ```sh
   bun add --dev --exact vite-plus@1.2.0
   ```

   This installs the project-local `vp` toolchain. Run it with `bun --bun vp`; no global installation is required.

2. **Install Stack.**

   ```sh
   bun add @prinpo/stack
   ```

   Stack includes its integrated libraries, CLI, and documentation for agents.

3. **Add this reference to your application's `AGENTS.md`.**

   ```md
   Before creating or changing application structure, frontend, backend, API queries,
   environment, database, authentication, logging, or development/build workflows,
   read node_modules/@prinpo/stack/docs/consumer/README.md and follow its task-specific links.
   Use Stack's applicable Blocks, helpers, and CLI before implementing custom integration.
   ```

Then ask your agent to build your app. It can use the installed docs to choose Blocks, configure the project, and follow Stack's patterns.

Start with the [documentation entry point](docs/consumer/README.md), [capability map](docs/consumer/capabilities.md), and [application patterns](docs/consumer/application-patterns.md). The references cover all Stack-owned helpers and operational CLI workflows; native APIs link to upstream documentation.

## Installation boundary

Stack requires Bun. Its CLI currently supports Linux. Stack owns its integrated library dependencies; UI applications install compatible React and React DOM peers, and applications own their Vite+ development tooling. Backend-only applications do not require React.

Use the application's installed executable with `bunx --no-install stack`, or from package scripts. See [application configuration](docs/consumer/application-patterns.md) for standalone manifests and [CLI workflows](docs/consumer/cli.md) for diagnostics, logs, schema operations, development, and builds.

Blocks remain independently composable wherever their underlying libraries allow. Applications own product UI, business rules, provider integrations, and deployment infrastructure.

## Attribution

The Eden Query connector is adapted from **eden-tanstack-react-query by Ilya Zhidkov and contributors**, under Apache-2.0. See [connector attribution and changes](src/eden-query/README.md) and [third-party notices](src/THIRD_PARTY_NOTICES.md).
