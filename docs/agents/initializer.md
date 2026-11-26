# Maintaining the project initializer

The initializer installs the version from its own published package manifest. Its tested toolchain pins live in `src/cli/init/toolchain.json`, because release packaging strips root development dependencies. Keep those pins aligned with root `package.json` when upgrading tooling. Run `bun run initializer:check`; CI runs the same check before validation.

Stack owns the copied Zed and VS Code data in `src/cli/init/editors/`. On a Vite+ upgrade:

1. Update dependencies and the initializer's toolchain pins intentionally, then install with Bun.
2. Run `bun run initializer:check`. It compares pins and hashes the installed Vite+ editor-generator region without importing or executing it. A changed version, changed generator, or missing region fails the check.
3. Review the matching upstream `packages/cli/src/utils/editor.ts` and installed generator. Update the owned settings where appropriate, preserving deliberate differences: local Bun tooling, no global VS Code script runner, and lint policy owned by application configuration. Retain attribution and the MIT notice.
4. Record the reviewed Vite+ version and reported generator checksum in `src/cli/init/editors/review.json`, then rerun the check and package validation. Do not refresh the baseline without reviewing upstream changes.

`bun run package:check` exercises a tarball through an isolated registry fixture. It checks exact-version initialization, local tooling with global `vp` excluded, Git hooks, editor choices, empty suites, type errors, test discovery with the generated frontend, and a build of the starter. It also checks the documented mounting helper through the installed package's dev server. These checks do not establish editor-extension behavior inside a running editor or support for operating systems other than Linux.

Existing projects own their configurations. Updating Stack does not overwrite those files; no configuration-upgrade command is provided.
