# Source-linked example development

The design interview is complete and the implementation boundary is confirmed.

## Purpose

Let examples exercise changes to Stack immediately during development. Prefer a straightforward development workflow over compilation speed or validating package distribution at this stage.

## Agreed boundary

- Examples inside this repository consume Stack's TypeScript source while retaining public `@prinpo/stack/...` imports.
- Keep examples as Bun workspaces with a `file:../..` dependency linking to the root Stack package. Stack's public exports point directly to its TypeScript source for this stage. Keep resolution consistent across Bun, Vite, and TypeScript without separate aliases or development conditions.
- The root package is `@prinpo/stack` and owns its library dependencies, optional peers, source exports, and development tooling. `src/` contains source files only. Bun's hoisted linker shares the root `node_modules` across the library and examples, with shared tooling versions aligned and one root lockfile covering all workspaces.
- Starting development requires no Stack build, package packing, or artifact installation.
- Changes to Stack code used by the browser update the application through HMR where possible. A full page reload is acceptable when necessary.
- Changes to Stack code used by the backend automatically restart the Bun process.
- Changes to Stack's Vite plugin automatically restart the example's Vite server.
- Required updates need no manual process restart.
- Prefer Vite and Bun's native dependency tracking and watching with minimal integration code. Do not implement a custom dependency graph or a separate watching framework to make reloads selective.
- Use selective updates where native tooling supports them. Broader reloads or restarts are a last resort when selective behavior would require substantial custom code. Changes to unused blocks do not need to trigger updates.
- Refreshing the browser after a backend restart is optional and does not block completion.
- Stack builds, package distribution, and production application builds are deferred.
- Remove artifact creation and installation from the development workflow, along with artifact-specific setup scripts and packaged-consumer checks. Existing build configuration may remain but is outside this milestone's scope.
- Update setup documentation to describe source consumption and the deferred build/distribution scope.

This revisits the built-package example and package-build verification requirements in [the full-stack foundation milestone](0001-fullstack-foundation.md). It preserves the public import conventions and application-owned development processes.

## Validation

Run the existing relevant tests and type/lint checks. Adapt checks that assume built package entry points to source exports where appropriate; artifact-dependent consumer checks are deferred. Preserve typed Eden usage, public import boundaries, and shared React resolution.

The user will verify refresh behavior manually. Automated browser E2E tests, a new reload-testing harness, package builds, and production application builds are outside this milestone's validation boundary.

## Decisions

- [Develop repository examples against Stack source](../adr/0004-develop-examples-against-stack-source.md)
