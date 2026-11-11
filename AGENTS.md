# Tooling

Use Bun and the project-local Vite+ toolchain pinned in `package.json`. Prefer `bun --bun vp <command>` (the explicit Bun-runtime form of `bun vp`) for direct Vite+ commands, including when a global `vp` is installed. Global installation is optional. Run commands directly through Bun; it resolves the local executable.

Install with `bun install --frozen-lockfile` when dependencies are missing or dependency manifests/the lockfile changed. Use `bun install` when intentionally updating dependencies. Read-only research with installed dependencies needs no install.

## Commands and validation

`bun --bun vp <name>` runs a Vite+ built-in; `bun --bun vp run <name>` runs a `package.json` script or `vite.config.ts` task. Check those files before choosing a command. From the root, `bun run dev` starts Stack's full-stack example; `bun --bun vp dev` starts Vite directly.

After changes, run `bun --bun vp check`, `bun --bun vp test`, and relevant project scripts/tasks such as `bun run example:check`. Package scripts can use bare `vp` because their PATH includes local binaries.

For tooling issues, inspect `bun --version`, `bun --bun vp --version`, and `bun --bun vp toolchain`. Use `bun --bun vp help` or `bun --bun vp <command> --help` for command details. Machine-management commands such as `vp env doctor` require the optional global CLI.

Vite+ docs are in `node_modules/vite-plus/docs` and at https://viteplus.dev/guide/. This file is repository-owned; `prepare` runs `vp config --no-agent` to configure hooks while preserving these instructions.

## Coding standards

Before changing code, committing, or writing pull-request metadata, read [CODING_STANDARDS.md](CODING_STANDARDS.md).

## Agent skills

### Issue tracker

Track issues and specs in GitHub Issues for `prinpo/stack`. Before reading or publishing tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` and `docs/adr/`. Before exploring the codebase, read `docs/agents/domain.md`.
