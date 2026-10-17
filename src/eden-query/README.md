# Eden Query connector credit and provenance

This directory is adapted from **eden-tanstack-react-query** by **Ilya Zhidkov and contributors**, published from [xkelxmc/eden-tanstack-query](https://github.com/xkelxmc/eden-tanstack-query). Stack maintains this copy so it can ship and repair the connector together with its pinned Elysia, Eden, and TanStack Query versions.

The baseline is **v0.5.0**, commit **`69ad5d0e0fcf489f7a3daac31c12a63de8b250af`**. The original source is [packages/eden-tanstack-query/src](https://github.com/xkelxmc/eden-tanstack-query/tree/69ad5d0e0fcf489f7a3daac31c12a63de8b250af/packages/eden-tanstack-query/src). All 12 source modules and their public exports are retained. The original project and its authors deserve credit for the implementation, types, API design, and regression coverage.

## License and attribution

The upstream material remains under **Apache-2.0**, with its original **Copyright 2025 Ilya Zhidkov** notice. The complete upstream license is preserved verbatim in [LICENSE](LICENSE). Upstream includes no separate NOTICE file at this commit. Stack's own MIT code does not replace the Apache license on this material.

Version, commit, credit, and modification history are centralized here. Each adapted source/test file retains only a short modification notice pointing here: Apache-2.0 section 4(b) requires modified files to state that they were changed. The package-level [third-party notices](../THIRD_PARTY_NOTICES.md) link to this record. Keep the modification notices and license when redistributing this material.

Upstream's changelog additionally credits [David Hermann (@RedEagle-dh)](https://github.com/RedEagle-dh) and [imoize](https://github.com/imoize) for fixes retained in this baseline. See the [original changelog](https://github.com/xkelxmc/eden-tanstack-query/blob/69ad5d0e0fcf489f7a3daac31c12a63de8b250af/packages/eden-tanstack-query/CHANGELOG.md) and [history](https://github.com/xkelxmc/eden-tanstack-query/commits/69ad5d0e0fcf489f7a3daac31c12a63de8b250af/).

## Stack modifications

- Centralized provenance here and retained one-line modification notices in adapted files; applied the repository formatter.
- Used extensionless relative module specifiers with Stack's ESNext/Bundler TypeScript configuration.
- Renamed upstream `context.tsx` to `context.ts` and expressed its provider nesting with `React.createElement`, preserving its behavior without JSX syntax.
- Changed package references in illustrative imports to `@prinpo/stack/query` where applicable.
- Exposed all original exports alongside native TanStack React Query through `src/query.ts`; Elysia and Eden remain pinned Stack dependencies.
- Adapted the upstream tests and test helpers into `tests/eden-query/`, retaining their assertions. Replaced test globals with explicit `vite-plus/test` imports and the Bun DOM preloader with a dedicated happy-dom test project. Test library imports use Stack's public entry points. Translated intentional test lint exceptions to Oxlint and explicitly ignored an existing fire-and-forget pagination promise. The compile-only compatibility fixture imports Stack's public query entry point.

The adaptation preserves runtime algorithms, type overloads, query/filter/key semantics, deprecated arguments, and upstream names. Further behavioral changes should be recorded here so comparison with upstream remains practical. The original package is not a runtime dependency.

Stack's separately authored `src/api-client.tsx` composes the retained factories into `createApiClient`, returning the Treaty client, QueryClient, options proxy, hooks, and a combined ApiProvider. Its optional prefix selects matching branches of the existing clients, preserving full request paths and upstream key identities. This helper does not change the adapted modules or their original public functions.

## Source mapping

- Upstream `packages/eden-tanstack-query/src/**` → Stack `src/eden-query/**`.
- Upstream `packages/eden-tanstack-query/src/context.tsx` → Stack `src/eden-query/context.ts`.
- Upstream `packages/eden-tanstack-query/test/**` → Stack `tests/eden-query/**`.
- Upstream `packages/eden-tanstack-query/test-utils/**` → Stack `tests/eden-query/test-utils/**`, except the Bun-only `happydom.ts` preloader.
- Upstream `packages/eden-tanstack-query/LICENSE` → Stack `src/eden-query/LICENSE`, unchanged.

Run `bunx --bun vp test --project eden-query` for the imported runtime tests and `bunx --bun vp check` for lint/type checks, including the compile-time fixtures. This is an initial connector import for review; these checks do not qualify every deployment or library combination for production.
