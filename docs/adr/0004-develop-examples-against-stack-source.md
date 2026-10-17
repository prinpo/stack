# Develop repository examples against Stack source

Repository examples use Bun workspace links and Stack's public `@prinpo/stack/...` exports resolve directly to TypeScript source at this stage. This favors immediate feedback while developing Stack over exercising a packaged consumer: builds, packed artifacts, installation of those artifacts, and distribution verification leave the active workflow. Existing build configuration may remain for later; Stack builds and production application builds are deferred.

The Stack package lives in the `src/` workspace, which owns its pinned library dependencies, optional React peers, and source exports. The private repository root owns development tooling. This keeps source files in place while allowing the installed Bun version to create native workspace links: depending on the repository root directly was either unsupported by `workspace:*` or installed a copy with a relative workspace reference.

Use Vite and Bun's native watching with minimal integration code to update browser modules, restart the backend, and restart Vite when Stack's plugin changes. Prefer selective updates; broader reloads or restarts are a last resort, and a custom dependency graph or watching framework is outside scope. Browser refresh after a backend restart is optional. Validation uses existing relevant tests and type/lint checks; the user will verify refresh behavior manually.

Run the example's client with Vite's config runner so imported Stack tooling becomes a tracked configuration dependency. Keep browser HMR and backend watching on their native paths.
