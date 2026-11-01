# Develop repository examples against Stack source

Repository examples are Bun workspaces linked to the root Stack package, whose public `@prinpo/stack/...` exports resolve directly to TypeScript source at this stage. This favors immediate feedback while developing Stack over exercising a packaged consumer: builds, packed artifacts, installation of those artifacts, and distribution verification leave the active workflow. Existing build configuration may remain for later; Stack builds and production application builds are deferred.

The root `package.json` defines `@prinpo/stack` and owns its pinned library dependencies, optional React peers, source exports, and development tools. `src/` contains source files without its own package manifest. This replaces the earlier private repository root and separate `src/` workspace, which added an unnecessary package identity for a single-library repository.

Examples use `file:../..` to reference the root package. With the hoisted linker, Bun creates a live symlink to the root; the original setup validation found that referencing the root with `workspace:*` failed. The current toolchain uses Bun 1.4.4. Configure `install.linker = "hoisted"` in `bunfig.toml`, keep shared tooling versions aligned, and place the example's Vite cache under the root `node_modules`. One root install and lockfile cover the library and examples. Conflicting versions can still require nested installations.

Use Vite and Bun's native watching with minimal integration code to update browser modules, restart the backend, and restart Vite when Stack's plugin changes. Prefer selective updates; broader reloads or restarts are a last resort, and a custom dependency graph or watching framework is outside scope. Browser refresh after a backend restart is optional. Validation uses existing relevant tests and type/lint checks; the user will verify refresh behavior manually.

Run the example's client with Vite's config runner so imported Stack tooling becomes a tracked configuration dependency. Keep browser HMR and backend watching on their native paths.

[ADR 0011](0011-publish-stack-source-through-explicit-release-channels.md) reopens the deferred distribution verification: Stack remains source-based, while CI validates an installed package tarball before publication. The source-linked example development workflow remains in place.
