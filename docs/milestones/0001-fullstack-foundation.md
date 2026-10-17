# Full-stack foundation

The follow-up [source-linked development milestone](0002-source-linked-development.md) replaces this milestone's built-package example requirement with direct source consumption and defers package-build and distribution verification. The remaining foundation capabilities continue to apply.

## Purpose

Make one basic full-stack application straightforward to assemble from Stack's independent blocks. Reduce repeated configuration while preserving the underlying libraries' native APIs and types.

## Included

- Bun for the backend and Vite+ for browser development and builds, invoked through `bunx --bun vp ...`.
- Elysia, Eden, TanStack Router, and router devtools, pinned as regular dependencies.
- React and React DOM as optional peers, imported from their upstream packages by UI consumers.
- Native library exports through `/server`, `/client`, `/react`, and `/devtools`.
- A `/vite` plugin preset combining React tooling, file-based routing, and an optional configurable API proxy.
- An opt-in Elysia plugin for serving browser assets and SPA navigation, with configurable asset directory and API prefix and preserved API 404s.
- Application-owned scripts for the frontend and backend development processes.
- Native Eden Treaty initialization using a type-only import of the inferred server application type.

Vite+ is consumer tooling rather than a Stack runtime dependency. Recommended application patterns are documented; directory layout remains flexible.

## Examples and completion

Create an `examples/` directory for runnable scenarios that demonstrate usage and expose the developer experience. Begin with one full-stack application that consumes the built Stack package and uses the browser, server, Eden client, router devtools, Vite preset, development proxy, and Elysia serving plugin together. Examples also serve as practical documentation.

The example demonstrates file-based routes and typed API requests through the same browser origin. Include a short setup guide and commands for running its browser and backend processes. Verify development behavior, package exports and build, type inference, and relevant focused checks. Keep browser entry points free of server runtime imports and server entry points usable without React installed.

The Elysia production serving utility is part of the implementation. Production application build verification and end-to-end testing are deferred.

## Deferred

TanStack Query and query devtools, Drizzle/database integration, Better Auth, Zod integration, evlog, varlock, and server-side rendering. Separate frontend-only and backend-only example applications can follow later; the initial blocks must still allow those uses. Scaffold templates and generators are outside the agreed approach.

## Decisions

- [Dependency ownership](../adr/0001-stack-owns-library-dependencies.md)
- [Independent blocks and native APIs](../adr/0002-compose-independent-blocks-with-native-apis.md)
- [Tooling and deployment](../adr/0003-vite-plus-and-bun-with-a-single-public-origin.md)
