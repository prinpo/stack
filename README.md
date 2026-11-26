# @prinpo/stack

Stack is a thin application framework that composes Bun, Elysia, Eden, React, TanStack Router, TanStack Query, Varlock, Drizzle, Better Auth, BullMQ, and evlog through a shared public interface and documented patterns.

## Installation

With Bun and Git installed, create a project with a TanStack Router frontend.

```sh
bunx @prinpo/stack init
```

Enter a project name and optionally select Zed, VS Code, both, or neither. Stack creates a new directory, installs its exact version with the tested local Vite+ toolchain and React peers, writes configuration and the `AGENTS.md` documentation pointer, initializes Git on `main`, and verifies checks and tests. No global `vp` is needed.

For unattended use:

```sh
bunx @prinpo/stack init my-app --no-editor
bunx @prinpo/stack@nightly init my-app --editor zed --editor vscode
```

Select an older published version with `bunx @prinpo/stack@<version> init`; the created project pins that exact version. Existing destinations are rejected, including empty directories. No initial commit or remote is created. If installation or checks fail, the directory is retained with recovery instructions.

```sh
cd my-app
bun run dev
```

Edit `src/routes/index.tsx` to change the home page. Use the generated `AGENTS.md` and the installed docs to extend the application. `bun run dev` starts additional services as you add backend or worker entry points. Use `bun run build` followed by `bun run preview` to run the built project locally. For production, run `bun run start` for HTTP and `bun run worker` for each worker replica. See [application patterns](docs/consumer/application-patterns.md) for adding Stack to an existing application.

Start with the [documentation entry point](docs/consumer/README.md), [capability map](docs/consumer/capabilities.md), and [application patterns](docs/consumer/application-patterns.md). The references cover all Stack-owned helpers and operational CLI workflows; native APIs link to upstream documentation.

## Installation boundary

Stack requires Bun. Linux is the tested CLI platform; other operating systems are not blocked but remain unverified. Stack owns its integrated library dependencies; UI applications install compatible React and React DOM peers, and applications own their Vite+ development tooling. Backend-only applications do not require React.

Use the application's installed executable with `bunx --no-install stack`, or from package scripts. See [application configuration](docs/consumer/application-patterns.md) for standalone manifests and [CLI workflows](docs/consumer/cli.md) for diagnostics, logs, schema operations, development, and builds.

Blocks remain independently composable wherever their underlying libraries allow. Applications own product UI, business rules, provider integrations, and deployment infrastructure.

## Attribution

The Eden Query connector is adapted from **eden-tanstack-react-query by Ilya Zhidkov and contributors**, under Apache-2.0. See [connector attribution and changes](src/eden-query/README.md) and [third-party notices](src/THIRD_PARTY_NOTICES.md).
