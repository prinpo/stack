# Empty-project initializer

The developer confirmed the complete scope. Implementation is complete and remains uncommitted.

## Agreed scope

- Ship interactive `bunx @prinpo/stack init`; also accept `init my-app` without the project-name prompt. Without a terminal or supplied name, fail with usage instructions.
- Accept a simple valid unscoped npm package name and create a direct child of the current directory. Reject any existing destination, including an empty directory; do not merge, overwrite, or initialize the current directory.
- Create infrastructure only: manifest, lockfile, tooling configuration, Git ignores, a short README, and `AGENTS.md` pointing to the installed consumer docs. No application source, routes, HTML, server, database, or example tests.
- Install the initializer's exact Stack version, including prereleases, and that release's tested local Vite+, TypeScript, compatible React/React DOM peers, and types. No globally installed `vp` is required.
- Adapt the root repository's type-aware linting, type checking, formatting/import ordering, generated-file exclusions, staged checks, and hooks for standalone applications. Generated configuration belongs to the application.
- Use Vite+'s Vitest runner by default. Discover tests under both `src/` and `tests/`, independently of the browser root. No-test runs succeed without a dummy test.
- Initialize Git on `main`, configure hooks, install dependencies, and run checks and tests before reporting success. Do not create an initial commit or remote.
- On failure, retain the created directory and report the failed step and recovery command. No automatic deletion or special resume command.
- Linux is the tested target. Remove the current CLI platform guard rather than rejecting other operating systems proactively; unsupported operations can fail normally.
- Keep Citty for command routing and argument/help handling. Use `@clack/prompts` for initializer interaction.
- After the project name, offer an optional editor multiselect containing Zed and VS Code. Start with neither checked and allow both or neither; defer other editors.
- Accept repeated `--editor` flags and `--no-editor`. Explicit editor flags skip the editor prompt; without flags, prompt in an interactive terminal and generate no editor files outside one. Reject unknown editors and conflicting flags before creating files.
- Collect and validate all interactive answers before creating the destination. Cancellation during prompts leaves no directory; cancellation after creation retains the directory under the failure policy above.
- Ship Stack-owned Zed and VS Code configuration files, copied into new projects and editable thereafter. Document required editor extensions. Do not import Vite+'s private editor generator or invoke application creation/migration to generate editor files.
- Tie editor configuration synchronization to upgrades of the pinned Vite+ toolchain: record the reviewed release, detect upstream generator changes, and require review/update of the owned settings. Preserve deliberate local Bun and application lint-policy differences. Do not automatically overwrite configurations or update existing applications.
- Fix Stack's React dependency-optimization bug. Update installation guidance to recommend init. Validate empty-project tooling without global `vp` and separately exercise the documented mounting helper through an installed consumer's dev server. Leave the existing test-app unchanged.

## Implementation and validation

- Added the lazy-loaded initializer, Clack interaction, exclusive directory creation, editable project configuration, selected editor files and attribution, exact-version dependency installation, Git/hook setup, and completion checks.
- Added a CI guard for initializer toolchain alignment and review of the installed Vite+ editor generator. It detects changes without importing private generator code or requiring network access.
- Qualified the packed prerelease through an isolated registry with global `vp` excluded: empty checks/tests, frozen installation, actual pre-commit execution, editor flags, test discovery after a browser entry, and rejection of a seeded type error.
- Changed release validation to use the documented mounting helper and reproduce the dev-server CommonJS failure before fixing the optimizer default.
- All 749 tests, root/example checks, editor guard, and the full-stack example production build pass. Prompt cancellation was verified at both prompts (exit 130, no destination created); the editor guard was verified to reject an unreviewed checksum.
- Standards review found no hard standards violations. Its recovery-command finding and dependency-cycle suggestion were addressed. Spec review found no discrepancies. Editor extensions were not exercised in running editors; Linux remains the tested platform.

## Architecture

[ADR 0022](../adr/0022-initialize-empty-projects-with-local-tooling.md) records the narrow exception to the earlier exclusion of generators and the platform-support boundary.
