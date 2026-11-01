# Public dynamic Varlock configuration in HTML

Research date: 2026-10-30. This records the investigation before implementation; the implementation outcome is recorded at the end. Inspected the installed, patched `varlock@1.23.0` and `@varlock/vite-integration@1.5.4`, their shipped source maps, Stack's environment/serving code, and primary documentation. Upstream source references use release commit `1b7fa9a4daa5eae432e6e3daa37a76cbb0089940`. Existing research convention: `docs/research/`.

## Recommendation

Deliver the selected public dynamic values in a synchronous inline script before application modules. In development, an async Vite HTML transform fetches the existing backend endpoint **from the Vite process**. In production, resolve configuration through the existing server startup, then use Bun `HTMLRewriter` once to prepare the in-memory app shell. Both emit the same boot payload. A normal `main.tsx` can then statically import application modules; no browser configuration request or separate bootstrap/application split is necessary.

This revises the original delivery decision in [ADR 0009](../adr/0009-resolve-deployment-configuration-at-runtime.md), which required browser fetching and retryable bootstrap; credential-free builds, explicit exposure, startup validation, and restart semantics remain applicable. Independent Blocks and configurable application layouts remain constraints under [ADR 0002](../adr/0002-compose-independent-blocks-with-native-apis.md).

## Native mechanism and initialization order

Varlock documents boot-time injection into `globalThis.__varlockPublicDynamicEnv`; this is an established integration mechanism, not a new Stack client store. Its Vite HTML replacement syntax `%ENV.KEY%` explicitly rejects dynamic values, so that syntax cannot deliver this payload. ([Pinned boot-injection guide](https://github.com/dmno-dev/varlock/blob/1b7fa9a4daa5eae432e6e3daa37a76cbb0089940/packages/varlock-website/src/content/docs/guides/dynamic-config.mdx#boot-time-injection), [pinned Vite implementation](https://github.com/dmno-dev/varlock/blob/1b7fa9a4daa5eae432e6e3daa37a76cbb0089940/packages/integrations/vite/src/index.ts#L881).)

The installed runtime's `initVarlockEnv` reads the boot global in its browser branch and calls `setPublicDynamicEnv`; module evaluation attempts this initialization automatically. Hydration filters against `__varlockPublicDynamicKeys` **only if that array already exists**. Without it, all supplied keys are accepted. Therefore emit metadata and values together before loading Varlock, rather than relying on assignments prepended to the entry module. The current native transform and Stack's `renderChunk` patch prepend module-body assignments; ESM dependencies can evaluate before that body, especially with separate chunks. ([Installed runtime](../../node_modules/varlock/dist/env-DaeLXABy.mjs), [installed integration](../../node_modules/@varlock/vite-integration/dist/index.mjs), the retired Stack Vite metadata patch.)

Recommended emitted order:

```html
<script>
  globalThis.__varlockPublicDynamicKeys = /* safely serialized selected key list */;
  globalThis.__varlockThrowOnMissingKeys = true;
  globalThis.__varlockPublicDynamicEnv = /* safely serialized selected values */;
</script>
<!-- Existing Vite/application module scripts follow. -->
```

Keep this a classic inline script: no `type="module"`, async work, imports, or browser fetch. Place it in the document head before app scripts. The HTML script processing model distinguishes synchronous classic scripts from module execution; ESM initializes imported dependencies before executing an importing module's body. ([HTML script processing](https://html.spec.whatwg.org/multipage/scripting.html#script-processing-model), [ECMAScript module evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-moduleevaluation).)

The native runtime's browser check also requires browser globals, including `navigator.userAgent`; Node/Bun probes need to provide these before importing it. Existing `loadPublicDynamicEnv()` short-circuits only when all declared keys have store entries, or an earlier fetch succeeded. Remove it from the HTML-delivery entry rather than depending on its completeness heuristic to guarantee zero browser requests. A known empty selection must also avoid calling it. ([Installed runtime and detection](../../node_modules/varlock/dist/env-DaeLXABy.mjs), [runtime detection](../../node_modules/varlock/dist/detect-runtime-WB-lS6-N.mjs).)

## Development: fetch the backend snapshot server-side

Vite's async, sequential `transformIndexHtml` hook can return tag descriptors using `injectTo: "head-prepend"`. Use a serve-only companion plugin, preferably a post HTML hook, so build execution never fetches deployment configuration or writes runtime values into `dist`. An inline classic script does not need Vite's module transform pipeline. ([Vite HTML hook](https://vite.dev/guide/api-plugin.html#transformindexhtml).)

Fetch an explicit absolute backend URL such as `http://localhost:3000/api/public-env`. This fetch runs inside Vite, not the browser, and does not automatically use Vite's inbound `/api` proxy. Use the backend origin directly to avoid routing back into the HTML transform. Reject failed status codes, non-object JSON, and missing selected required values; do not render a usable app shell with partial configuration. Use a bounded timeout and fail that HTML request with an actionable error. Fetch on HTML requests initially: a backend restart can then be picked up by reloading the page, without a new cache invalidation mechanism. Do not fetch at Vite config import, where the parallel backend may not be listening yet. These are recommended policies derived from the hook lifecycle and the example's separate processes. ([Current Vite setup](../../examples/fullstack/vite.config.ts), [parallel dev scripts](../../examples/fullstack/package.json), the former public endpoint.)

Keep the endpoint's explicit selection. Validate every selected key against the client graph's public dynamic metadata, and filter the fetched object to that selection before serializing. The backend validates its own graph; it does not prove that a differently declared client graph has matching types. Shared schema imports remain the intended way to align them. Do not forward arbitrary browser headers/cookies to the backend for process-wide configuration. ([Client/server schemas](../../examples/fullstack/env/), the former explicit exposure validator, [ADR 0009](../adr/0009-resolve-deployment-configuration-at-runtime.md).)

### Why not resolve locally by default?

The Stack Vite wrapper intentionally loads only static client values while preserving dynamic metadata. At research time the example set `PUBLIC_DEPLOYMENT_NAME=local` on **the backend command only**; it now loads that value from the backend development profile file. Removing static-only mode or loading client dynamic values in Vite would require a second runtime resolution lifecycle, could run providers twice, and would not automatically reproduce the backend process's overrides. Calling `getPublicDynamicEnv()` in Vite currently does not recover the backend snapshot. ([Wrapper](../../src/env/vite.ts), [core patch](../../patches/varlock@1.23.0.patch), [example scripts](../../examples/fullstack/package.json).)

Local resolution remains a valid explicit option for frontend-only applications: an application-owned async value provider can run a public-only schema loader and return its validated snapshot. Keep this capability behind the same value-source interface rather than building a second Stack resolver, mutating the native integration's shared runtime state, or importing the backend app into Vite. Full-stack development should default to the backend endpoint because it is already the startup-validation authority. This is a design recommendation, not a claim that upstream provides a local-resolution callback.

## Production: rewrite once, serve every app route consistently

`serveAppPlugin` already reads `dist/index.html` once. After Varlock server initialization, obtain the explicit subset using `getPublicDynamicEnv(keys)` and rewrite that string once. Bun supports synchronous `HTMLRewriter.transform(string)` with synchronous handlers; `element.prepend(script, { html: true })` inserts the prepared script into the head. Alternatively, consume `transform(new Response(html)).text()` completely during initialization. Finish rewriting and validating the result before serving it. No per-request rewriter is needed. ([Current serving helper](../../src/serve-app.ts), [Bun HTMLRewriter](https://bun.com/docs/runtime/html-rewriter).)

**Root-route trap:** the pinned static plugin registers each HTML file directly, plus directory aliases for `index.html`. Consequently `/` and `/index.html` can return the original disk file even if the wildcard SPA fallback returns a rewritten shell. Exclude the app's exact HTML file from static registration using an absolute-path `RegExp`, then serve the rewritten shell explicitly at `/`, `/index.html`, and eligible deep links. `indexHTML: false` only disables aliases and does not prevent direct `/index.html` registration. Preserve other static files, API misses, GET/HEAD semantics, and the existing asset-looking-path exclusions. ([Installed static plugin](../../node_modules/@elysiajs/static/dist/index.mjs), [published pinned source](https://unpkg.com/@elysiajs/static@1.4.10/dist/index.mjs), [current fallback](../../src/serve-app.ts).)

Keep rewritten HTML in memory rather than overwriting the shared build directory. Cache policy must apply to all shell routes: prefer `no-store` for deployment-specific shell HTML initially. Existing fallback `no-cache` permits storage with revalidation; any validators must describe the rewritten deployment-specific bytes. This follows HTTP cache semantics. ([RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2).)

The server's existing auto-load entry reuses the graph validated by `varlock run`. Read and serialize values after that initialization; do not resolve a second graph or self-fetch the endpoint before the server has started. Current `serveApp` registers an async plugin; verify failures of shell preparation propagate through Elysia startup rather than becoming a detached rejection. ([current initialization](../../src/env/server.ts), [server entry](../../examples/fullstack/src/server/index.ts), [serveApp](../../src/serve-app.ts).)

## Serialization boundaries

- `getPublicDynamicEnv` returns a plain object of typed values, not an HTML-safe serialization format. Keep numbers, booleans, objects, and arrays as JSON values; do not convert through `process.env` strings. Never inject the complete `__VARLOCK_ENV` graph. Preserve the endpoint's special handling for `keys: []`: native `getPublicDynamicEnv([])` means all declared keys, not none. ([Installed helper](../../node_modules/varlock/dist/env-DaeLXABy.mjs), the former Stack endpoint.)
- Escape every literal `<` in serialized data to `\u003C` before placing it inside a script. This prevents `</script>` termination and script-parser comment states. JSON quoting alone is insufficient; HTML entities inside script raw text are not an equivalent solution. Escaping U+2028/U+2029 additionally supports older JS parsers. ([HTML script restrictions](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements), [pinned Varlock recipe](https://github.com/dmno-dev/varlock/blob/1b7fa9a4daa5eae432e6e3daa37a76cbb0089940/packages/varlock-website/src/content/docs/guides/dynamic-config.mdx#boot-time-injection).)
- Prefer emitting `JSON.parse(<quoted JSON string>)` over treating JSON text as a JavaScript object literal: a `"__proto__"` property has special object-initializer semantics. Apply HTML-safe escaping after the outer stringification too. Native hydration assigns keys into ordinary objects, so reject dangerous prototype-related names at this boundary unless separately qualified. ([ECMAScript JSON.parse](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse), [object initializer semantics](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-object-initializer-runtime-semantics-propertydefinitionevaluation), [installed hydration](../../node_modules/varlock/dist/env-DaeLXABy.mjs).)
- JSON drops object properties whose value is `undefined`; non-finite numbers become `null`, and BigInt/cycles fail serialization. An omitted optional dynamic key can become a throwing missing-key access under strict Varlock metadata. Define and qualify an explicit policy: initially restrict payloads to JSON-compatible values, or restore selected optional undefined entries from schema metadata before native hydration. Do not silently translate absence to `null`. Neither native endpoint hydration nor the existing probe qualifies arbitrary type round trips. ([ECMAScript JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify), [runtime proxy](../../node_modules/varlock/dist/env-DaeLXABy.mjs), [existing probe](../../scripts/probe-varlock.ts).)
- If the application has CSP, its inline-script policy must allow the emitted script, for example with an application-owned hash of the exact startup script. Do not implicitly weaken the policy. Per-request nonces require corresponding per-request HTML/header handling and do not fit a single immutable shell string unchanged. ([CSP script policy](https://www.w3.org/TR/CSP3/#directive-script-src).)

## Minimal flexible interface

Keep policy and transport separate. The following is a proposed shape, not final API naming:

```ts
type PublicEnvSource = () => Record<string, unknown> | Promise<Record<string, unknown>>;

// Extend native Vite options; retain all existing upstream options.
varlockVitePlugin({
  publicEnv: {
    keys: ["PUBLIC_DEPLOYMENT_NAME"],
    source: () => fetchBackendSnapshot(backendPublicEnvUrl),
  },
});

// Generic serving seam; env Block supplies the transform.
serveApp(app, {
  isProduction: true,
  transformHtml: (html) =>
    injectPublicEnvHtml(html, {
      keys: ["PUBLIC_DEPLOYMENT_NAME"],
      values: selectedValidatedServerValues,
    }),
});
```

Use one serializer/script builder shared by Vite and Bun adapters. Keep `transformHtml?: (html: string) => string | Promise<string>` generic and run it once during serving initialization. This avoids making the serving Block depend on Varlock, while allowing other startup HTML transformations. The environment Block owns key validation, filtering, and serialization. Vite's value callback supports backend fetch, local public-only resolution, or application-owned sources without separate URL/local mode flags. A convenience URL adapter can follow if repetition warrants it. Production receives values directly from the initialized server; the dev endpoint remains useful without browser access.

## Evidence and remaining qualification

Executed disposable probes with the installed dependencies; no implementation files changed:

1. Set browser globals, key metadata, and boot values before importing the real installed Varlock runtime. The declared value was available immediately; an undeclared payload key was rejected; `loadPublicDynamicEnv` made **zero** fetch calls for the complete declared payload.
2. Ran Vite `createServer` with an async serve-only HTML hook fetching a temporary Bun backend. `transformIndexHtml` awaited the backend and returned HTML containing its snapshot; exactly one backend request occurred. Both servers were closed.
3. Ran Bun `HTMLRewriter` against a string with a synchronous head handler; injected code preceded the module script. This shell's Bun reported **1.4.4**, whereas the project manifest requests **1.4.3**; this probe does not certify that pinned runtime.

At research time, [probe-varlock.ts](../../scripts/probe-varlock.ts) tested emitted-module fetch hydration and retry using happy-dom; it does not test HTML script execution. Before implementation is accepted, qualify a real browser with a single statically importing entry and import-time `ENV` reads, including split dependency chunks; assert zero browser config requests. Build once and serve two startup snapshots; cover `/`, `/index.html`, deep links, HEAD and API misses, backend unavailability/recovery, hostile script strings, typed JSON and optional values, and absent/duplicate injection targets. Ensure builds never invoke the runtime source. These are proposed acceptance checks, not completed results.

Setup: global `vp` was unavailable; `bun node_modules/vite-plus/bin/vp install` completed successfully with no manifest/lock changes. Research does not need implementation test suites.

## Implementation outcome

Implemented `varlockVitePlugin({ publicEnv: { endpoint } })` as the concise backend-source option. Its development-only HTML hook filters the response to client public dynamic metadata. Retained native options and custom hydration for other hosting arrangements rather than adding a speculative source abstraction. Production uses `publicEnvHtml({ keys })` through the generic `serveApp.transformIndexHtml` hook. Both emit metadata and HTML-safe JSON before modules. ADR 0009 and the environment guide now describe this delivery strategy.

The revised repository probe runs on toolchain Bun 1.4.3: it builds once with an unreachable development endpoint, serves the artifact with different startup values, checks all document paths and HEAD, and evaluates its emitted modules with happy-dom globals and browser `fetch` disabled. An imported module reads configuration at evaluation time and a lazy chunk reads it afterward. It also verifies hostile script strings, unchanged artifacts, development filtering, invalid payloads, backend failure/recovery, and schema reload. This is automated emitted-module and HTTP integration coverage; real-browser E2E remains outside the repository's current qualification.

The example now has two independent environment directories. Standard `startServer` loads server configuration and a separate public client snapshot, deriving exposure from client metadata without cross-schema imports or application key lists. `stack({ api: true })` reads owned backend connection settings from files for development proxying and HTML delivery. The production selector remains `env/server/.env.start` until the planned CLI owns profile selection. Runtime integration coverage checks defaults and overrides, client/server separation, provider reuse, and connection-only Vite resolution.

## Development delivery simplification

The development HTTP transport described above has been superseded: Vite now uses the shared client resolver to load its public dynamic values directly from schema and profile files. Standard server startup no longer registers `/api/public-env`, and in development it does not resolve client configuration. Production startup still resolves the client snapshot and injects HTML. The independent public-only validation and serialization rules are shared between both paths. Tests now verify that Vite serves configured HTML after the backend stops, that standard startup returns 404 for the removed endpoint, and that production injection continues to isolate client values from server secrets.

## Retired compatibility surface

The endpoint transport, `env/elysia` entry, explicit server-key HTML adapter, manual hydration exports, and separate `env/auto-load` entry have been removed. `env/html.ts` now supplies shared metadata serialization and production injection; server initialization reuses its validated native graph internally. The Vite entry-metadata patch was also removed after the same emitted-module probe passed without it. The remaining core patch is still required for static-only/public-only loading. Earlier sections record the original investigation and superseded interfaces, not current setup instructions.

Current integration note: the core package patch has also been retired. Stack now owns static graph selection and browser replacement against unmodified Varlock; see [the environment guide](../env.md#unpatched-varlock-integration). Patch requirements above describe the historical implementation.
