# Optional Varlock environment integration

The design interview is complete and the user authorized implementation, including narrowly maintained upstream patches after the feasibility gate reproduced two blockers. The Block and source-linked example are implemented; the environment guide documents the supported workflow and patch boundaries. [ADR 0009](../adr/0009-resolve-deployment-configuration-at-runtime.md) records the decisions, and the [research note](../research/varlock.md) separates upstream evidence from integration findings.

## Purpose

Provide an optional environment Block with Varlock's native schema-driven loading, validation, typed access, and public/secret classification. Preserve native concepts and keep Stack's additions limited to repeated integration work. Applications can adopt the Block independently of the router, server, and logger wherever upstream allows.

## Agreed scope

- Stack owns exact versions of Varlock core and its Vite integration. Applications install and configure their own optional provider plugins.
- Recommend separate browser and backend schema load roots, selective shared imports, and locally generated typed access. Do not require separate packages or enforce an application directory layout.
- Default schema definitions to sensitive. Preserve Varlock's sensitivity-based static/dynamic default: credentials are dynamic, while explicit public values can be static or explicitly dynamic. Public static metadata may be committed when intended to remain identical across deployments of an artifact.
- Builds resolve and validate their static inputs without requiring or fetching dynamic credentials. Preserve schema information and generated types for dynamic values without resolving those values. Browser inlining contains only public static values.
- Static values must have static dependencies. A value with a dynamic dependency must itself be dynamic. Add an early configuration error if a small, reliable upstream-based check is feasible; do not create a dependency-analysis framework.
- The effective client schema, including imported entries, contains only explicitly public values. Client exposure and timing classification must be inspectable without resolving runtime values. Verify a reliable rejection path for sensitive entries and runtime-dependent classification before claiming enforcement.
- Use native `varlock run -- bun ...` application-owned startup scripts and disable Bun's automatic dotenv loading. Validate the process's required runtime configuration before accepting traffic. Restart instances after configuration changes; no live rotation or refresh system is included.
- Provide an opt-in Elysia endpoint under the API namespace, with configurable path and `Cache-Control: no-store`, returning only the browser's declared public dynamic values through native Varlock helpers. Do not return every public backend setting automatically.
- Browser applications needing public dynamic values hydrate them before importing and initializing application modules. Failed bootstrap shows a clear retryable error instead of silently initializing with fallback configuration. Static-only browser applications need no runtime fetch.
- Keep runtime imports browser-safe, server loading explicit, and Vite integration optional. Preserve native `ENV` and public-runtime helper concepts; prefer reexports and narrow integration helpers over a custom configuration API or launcher. Verify generated typing and transformation through Stack's public paths before settling exact signatures.
- Disable native output redaction and response leak detection in the documented setup (`@redact=false`, `@preventLeaks=false`). Developers own secret-handling discipline. Enabling those protections is an experimental application opt-in outside this milestone's evlog qualification; add no logger coupling or custom drains.

## Feasibility gate

Before implementing the public interface, run a focused compatibility spike against Stack's pinned Bun and Vite+ config runner, source-linked exports, and TanStack Router splitting. This gate verifies the agreed behavior rather than expanding it.

The main source-level concern is that filtering out dynamic values also appears to remove the metadata used by the Vite plugin for public dynamic hydration. Do not work around missing credentials by inventing dummy secrets, making required runtime entries optional, or disabling validation globally.

A strict client-schema preflight may require the upstream exported `internal` graph API. Any such use must remain small, version-pinned, and covered by focused tests. If the requirements demand a substantial fork, resolver, or replacement plugin, surface the concrete incompatibility and revisit the design rather than silently expanding Stack's abstraction.

### Reproduced gate result

Run `bunx --bun vp run research:varlock`. The original unpatched probe used Bun 1.4.3, Vite+ 1.2.0 with the config runner, Varlock 1.23.0, and Vite integration 1.5.4. It built a temporary public-only schema and evaluated emitted JavaScript in happy-dom; this was not a real-browser E2E test. Only synthetic values were used. The command now runs the patched contract probe described below; Varlock packages are pinned runtime dependencies of the optional Block.

1. A required public dynamic value prevents an ordinary unfiltered build when its value is absent.
2. `_VARLOCK_FILTER=!@dynamic` permits compilation, but ordinary HTML-entry builds do not inject the public-dynamic allowlist. Hydration accepts an undeclared key as well as the intended key. Supplying the dynamic value at build time does not fix this missing entry metadata.
3. Forcing entry recognition with the native `ssrEntryModuleIds` option isolates the second blocker: filtered builds inject an empty allowlist and the intended runtime value cannot be read after hydration.
4. With entry recognition forced and the dynamic value supplied during compilation, the control succeeds: the runtime value is hydrated, the undeclared key is rejected, and the build-time dynamic value is absent from the emitted artifact.

The source-level filter concern is therefore reproduced, alongside a separate entry-recognition issue in this Vite+ HTML-entry setup. A normal-looking successful hydration without an allowlist is not sufficient qualification. Native integration exposes no graph-loading callback that resolves static values while retaining dynamic metadata. The user chose targeted upstream patches. No replacement plugin, incomplete frozen graph, fabricated runtime values, or global validation bypass is used.

## Validation

- Build browser and backend artifacts without deployment credentials or dynamic provider calls. Missing or invalid required static inputs fail compilation; missing or invalid required runtime inputs fail startup.
- Serve exactly the same browser build with two different runtime public configurations. Verify the values change without rebuilding and that native `ENV` access works after bootstrap.
- Verify the composed client graph rejects sensitive static and dynamic entries, including imports, before resolving their values. Verify runtime-dependent client classification is rejected.
- Verify the static-to-dynamic dependency guard if feasible; otherwise document the precise enforcement limitation and revisit it before claiming the guard exists.
- Verify the public endpoint excludes credentials and public backend-only keys, sends no-store headers, and remains distinct from SPA fallback/API misses. Use synthetic values to inspect browser assets and payloads.
- Verify bootstrap ordering with an application module that reads configuration at import time, plus a failed request and retry. Server-side validation remains the authority; native browser hydration alone does not validate per-key types or completeness.
- Verify separate generated client/server types, native static access through intended imports, schema reload behavior, and ordinary application logging without enabled Varlock interception.
- Run `bunx --bun vp check`, `bunx --bun vp test`, and `bunx --bun vp run example:check` after implementation. Keep checks focused on the environment contract.

Browser build verification is necessary for this milestone's explicit artifact-reuse contract, extending the earlier source-only validation scope for this integration. Package distribution checks, a Docker deployment platform, database/auth integrations, external provider provisioning, automated browser E2E, live refresh, and custom logging protections remain outside this milestone.

## Implemented interface and qualification

The interface has evolved from the original endpoint-based bootstrap described in the plan above:

- `@prinpo/stack/env` exposes native browser-safe ENV access and schema types; generated local modules retain native imports and isolated types.
- `startServer` initializes the server graph before app imports and derives production client HTML from its independent schema. There are no application key lists or automatic env endpoints.
- `stack({ api: true })` includes native static-only/public-only browser compilation, file-derived API proxy settings, and local client dynamic resolution during development.
- `src/env/html.ts` shares serialization between Vite and production injection. The retired Elysia env helpers, separate auto-load entry, and manual hydration exports were removed.
- The core Varlock patch remains. The Vite metadata patch was retired after the emitted-module probe passed with metadata provided entirely through HTML.

The probe builds one browser artifact through Stack exports and serves it through standard startup under different runtime values. It verifies import ordering, lazy modules, unknown-key rejection, safe script values, local development resolution, native schema reloads, and imported-schema checks. Runtime tests cover independent client/server values, CLI provider reuse, missing credentials, empty client snapshots, and failure before listening when the HTML head is missing. Build tests cover static-only validation and public-only classification.

See [the environment guide](../env.md#pinned-upstream-patches) for the remaining root patch and the limitation that dependency manifests do not apply it transitively. Automated real-browser E2E and package distribution remain deferred.

## Original milestone verification result

- Full suite: 609 tests passed across 40 files. The environment subset has 19 tests, including real CLI processes and the emitted-module/reload probe.
- Root `vp check` and `vp run example:check` passed without warnings or type errors. Compile-only checks retain separate client/server types and precise endpoint route keys.
- The complete example browser/backend build passed with deployment values absent. The same built server was exercised under two runtime configurations, and the same browser artifact was evaluated under two payloads.
- A forced frozen-lockfile reinstall successfully reapplied the checked-in patches before the focused checks and full suite.
- Standards review found an overly broad backend metadata restriction and incidental Bun cache-marker additions. Both were corrected. Spec review found direct effectful classification was not rejected; literal-classification checks and a no-execution regression now cover it. Conditional backend requirements remain validated at runtime.

Current integration note: the core package patch has also been retired. Stack now owns static graph selection and browser replacement against unmodified Varlock; see [the environment guide](../env.md#unpatched-varlock-integration). Patch requirements above describe the historical implementation.
