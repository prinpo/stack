# Auth development delivery: backend wiring and build exclusion

Research date: 2026-11-11. Design evidence, not an implementation or an accepted ADR. Repository baseline: `3c460758f0077256cec1d5458ad8a52cb8917d4e`, plus the current Auth milestone and ADR 0020. Bun inspected locally: 1.4.4. Better Auth is not yet a Stack dependency; upstream behavior below is specifically verified against tag **v1.7.18**, not a proposed version pin.

## Recommendation

Use a **Stack-dev-owned Bun preload**, an **inert runtime delivery facade**, and a **Vite-owned private, request-targeted delivery channel**. Declare the optional development transport once in Vite configuration. Keep actual transport implementations reachable only from development tooling, and make browser injection serve-only. Do not infer activation from `NODE_ENV`, `APP_ENV`, Vite mode, or the presence of an environment variable alone.

For the standard built entry, add an early, irreversible built-artifact lock through a native Bun banner **side-effect import**, or use a generated bootstrap that locks before dynamically importing the application. A statement banner alone is too late for external module initialization. Keep normal application senders independent; the development bridge supplies a fallback only for an enabled flow lacking an application sender. A callback facade must distinguish “delivery unavailable” from success: a general `browserLog` no-op is not a successful email sender.

This is the smallest viable _general_ design found here. A response-only bridge is smaller if explicitly restricted to callbacks that enqueue synchronously before the response finishes; it does not cover arbitrary delayed/background callbacks. No extra relay process, AST transform, global console interception, or source rewriting is necessary. The private cross-process channel is still new wiring, and its exact protocol needs a small qualification prototype before implementation is approved.

## Repository boundaries that determine the design

Read first: [AGENTS.md](../../AGENTS.md), [coding standards](../../CODING_STANDARDS.md), [domain guidance](../agents/domain.md), [glossary](../../GLOSSARY.md), [Auth milestone](../milestones/0007-auth.md), and relevant ADRs 0001–0003, 0008–0011, 0015, 0019, and [0020](../adr/0020-use-better-auth-for-the-auth-block.md).

| Actual source                                                                                                           | Consequence                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/cli/lifecycle.ts`](../../src/cli/lifecycle.ts), `dev`                                                             | Starts two children: Bun `--watch --no-clear-screen src/server/index.ts` and Vite+ dev. Backend launch currently precedes frontend launch; there is no shared JS heap or transport handshake. Compose readiness precedes both; server-env changes stop and relaunch both. |
| [`src/cli/frontend.ts`](../../src/cli/frontend.ts)                                                                      | Native Vite configuration executes with `--configLoader runner`, application-root config discovery, and `src` as root. Reuse this process; importing config separately in the backend risks executing plugins twice.                                                      |
| [`src/vite.ts`](../../src/vite.ts)                                                                                      | `stack()` composes native plugins and optional `/api` proxying. Its configuration hook runs for builds too. Vite `define` and browser transforms do not transform the separate Bun process.                                                                               |
| [`src/cli/lifecycle.ts`](../../src/cli/lifecycle.ts), `build`                                                           | Builds client first, then `bun build --target bun --packages external`; writes `dist/manifest.json` only after success. Existing banner sets `_STACK_DATABASE_BUILT`. Backend build compiles source; it does not need to execute auth configuration.                      |
| Same file, `start`                                                                                                      | Selects built output using the manifest and replaces the CLI with Bun via `execve`; no development supervisor remains. It forces production mode, but direct `bun dist/server/index.js` can use a different mode and must also remain safe.                               |
| [`src/start-server.ts`](../../src/start-server.ts), [example entry](../../examples/fullstack/src/server/index.ts)       | Validates environment, then dynamically imports the application, waits for modules, and opens the listener. Native server reexports stay import-safe. This is a useful startup validation boundary, but arbitrary apps can import auth before calling it.                 |
| [`src/processes.ts`](../../src/processes.ts), [`src/cli/tools.ts`](../../src/cli/tools.ts)                              | Bun children use process groups, disabled dotenv loading, and labeled stdout/stderr forwarding. There is no current IPC channel; adding one must preserve group cleanup.                                                                                                  |
| [`src/database/kit.ts`](../../src/database/kit.ts)                                                                      | Already uses native `--preload` for a child-only capability. This establishes a local pattern without changing application files.                                                                                                                                         |
| [`package.json`](../../package.json), [ADR 0011](../adr/0011-publish-stack-source-through-explicit-release-channels.md) | Stack ships TypeScript source with explicit exports. Runtime consumers retain installed Stack source; externalizing it does not strip its internal files.                                                                                                                 |

[ADR 0001](../adr/0001-stack-owns-library-dependencies.md) explicitly permits backend dependencies to remain installed in frontend-only apps. [ADR 0009](../adr/0009-resolve-deployment-configuration-at-runtime.md) requires credential-free builds. [ADR 0008](../adr/0008-complete-request-logs-after-the-final-response.md) gives ordinary logs their own lifecycle. These support graph separation and startup validation, not a promise that every development byte disappears from `node_modules`.

## Native mechanisms compared

Bun documents [`--preload`](https://bun.sh/docs/runtime#dependency-module-resolution) before application module loading and [custom export conditions](https://bun.sh/docs/runtime/module-resolution#custom-conditions) at both build time and runtime. Its [bundler](https://bun.sh/docs/bundler) supports external packages, defines, and banners. The comparisons below include direct local observations, so they do not assume bundled dependency behavior applies to external source.

| Mechanism                                      | Useful role                                                                                                 | Limitation / decision                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Child-only Bun preload                         | Install an adapter before source auth configuration imports; replay installation on native process restart. | Must be added only by `stack dev`, never a persistent `bunfig.toml` preload. Preload registration is not authorization to deliver to every browser. Recommended activation boundary.                                                                                                                                                                                                                                                |
| Custom export condition, e.g. `stack-auth-dev` | Select an active implementation during source development, defaulting to an inert implementation otherwise. | With external packages, runtime conditions select the file again. Build conditions do not freeze that choice. Avoid `development` as the selector. An extra custom condition buys little over preload registration and needs a built lock anyway.                                                                                                                                                                                   |
| Compile-time define                            | Remove branches in application code actually traversed by the Bun build.                                    | Does not rewrite external Stack modules. A facade inside external Stack cannot rely on an application build define. Vite defines only cover its own graph. Not the sole boundary.                                                                                                                                                                                                                                                   |
| Statement banner                               | Mark a built entry before its bundled top-level statements execute.                                         | Static external dependencies initialize before the statement. Existing database banner is not evidence that an auth guard is early enough. Useful only with carefully deferred imports and per-call checks.                                                                                                                                                                                                                         |
| Banner side-effect import                      | Evaluate a small inert built-lock module before other external imports in the standard emitted entry.       | Lock must have no dependency on auth/transport and no import cycle; runtime facade checks it on every delivery. Preserve the import through packaging; if it ever traverses another bundler, account for Stack’s `sideEffects: false` metadata rather than assuming a side-effect import survives optimization. Alternative: generated wrapper locks, then dynamic-imports app. Recommended hardening of the native build boundary. |
| Explicit `browserLog` facade                   | Import-safe API that defaults to no-op and never imports Vite, console patches, or transports.              | Facade and call arguments can remain in external source. No-op calls still evaluate arguments. Do not pass credentials into ordinary logging or treat no-op as successful auth delivery. Useful foundation, not sufficient auth policy.                                                                                                                                                                                             |
| Request-local response bridge                  | Collect delivery records around `auth.handler(request)` and attach them only to that request’s response.    | Reliable only for enqueue-before-finalization; response cannot acquire later records. Preserve cookies/status/body and handle errors, redirects, streaming, native server calls. Restricted alternative, not general recommendation.                                                                                                                                                                                                |
| Request-local route plus asynchronous mailbox  | Snapshot a browser/request capability at callback entry and deliver later through a private channel.        | Requires bounded queues, expiry, readiness and restart rules. Covers delayed callbacks without changing Better Auth response contracts. Recommended when background delivery is in scope.                                                                                                                                                                                                                                           |
| Bun runtime resolver plugin                    | Redirect an exact module specifier to an active development implementation.                                 | [Native hooks](https://bun.sh/docs/runtime/plugins#onresolve) support this without editing source. Still introduces resolution/cache and external-runtime interactions. Prefer a small explicit registry before introducing resolver interception.                                                                                                                                                                                  |

### Local Bun probes

Temporary fixture only, outside the repository, under `/tmp/stack-auth-probe-2uewb5kd`. No manifests or dependencies in this repository were changed. The fixture package exported active/default implementations via `stack-auth-dev`; its initialization printed the built marker, and it referenced an application build define. Commands used the installed Bun 1.4.4:

```sh
bun build --target bun --packages external --conditions stack-auth-dev \
  --define __AUTH_DEV__=false --banner 'globalThis.built=true;' \
  entry.ts --outfile statement.js
bun statement.js
bun --conditions stack-auth-dev statement.js
```

Observed: emitted output retained `import ... from "probe"`; the application define became `false`, the external module’s define remained undefined, and runtime conditions changed NOOP to ACTIVE. Both external initializers saw the built marker as undefined. The banner ran afterward.

Changing only the banner to `import "probe/guard";`, with that dependency setting the marker, made external initializers see `true`. Adding `--preload ./preload.ts` ran preload first, then guard, then external initialization. Thus a built lock must also revoke previously registered adapters and be checked per call; a preload can run before any entry’s guard. These are fixture observations, not proof of a complete auth integration. ESM dependency evaluation is specified by [ECMA-262 module evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-moduleevaluation).

A second local probe used `AsyncLocalStorage.run({ id: "A" }, ...)`: a timer created inside the scope retained A after `run` returned; code outside saw undefined. This establishes ordinary timer behavior on this Bun version, not worker/queue propagation.

## What “excluded from builds” can mean here

Distinguish three guarantees:

1. **Browser artifact exclusion:** serve-only HTML injection adds the receiver only while developing. Build output contains no receiver, delivery routes, client transport setup, or dev credentials. Do not statically import the receiver from the application client. Native [`configureServer`](https://vite.dev/guide/api-plugin.html#configureserver) is not called during builds; `apply: "serve"` and serve-only `transformIndexHtml` can define the tooling boundary. Vite preview must not activate delivery.
2. **Server execution-graph exclusion:** production auth/server imports lead only to the inert facade and small built lock. No facade import or dynamic fallback may reach the dev adapter. Dev-only adapter and Vite implementation are loaded by CLI/preload/serve tooling only. Merely setting `NODE_ENV=development` cannot install them. A built lock denies even a stale registered adapter.
3. **Physical absence from installed dependencies:** not provided by `--packages external`. The deployed Stack source package can still contain development implementations. Removing those files requires separate development packaging or an explicit deployment pruning contract. Tree-shaking external modules cannot achieve this. Even a no-op facade can remain on disk and in the runtime import graph.

Recommendation: qualify the requirement as exclusion of the active integration from browser output and the normal built-server execution graph, with activation denied regardless of runtime mode. If “no dev implementation bytes anywhere in the deployment” is literal, reopen the packaging decision; do not claim the current build architecture satisfies it. This clarification follows the Auth requirement in [ADR 0020](../adr/0020-use-better-auth-for-the-auth-block.md), rather than silently weakening it.

The built lock should be private process state, monotonic and non-resettable through the supported API, not another environment toggle. Use one shared identity across external Stack modules and any bundled facade copies; keep the guard dependency-free. For ordinary supported startup, default-no-adapter plus build locking is enough. It is not a sandbox against application code deliberately editing globals, replacing modules, or bypassing the built entry.

## Better Auth callback timing: response-only delivery is conditional

Verified primary source, tag v1.7.18:

| Path                                                                                                                                           | Observed behavior                                                                                                                                                        | Delivery implication                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Magic-link source](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/plugins/magic-link/index.ts#L249-L295)    | Stores the verification value, builds the URL, directly awaits `sendMagicLink(data, ctx)`, then returns JSON. Callback context parameter is optional in its public type. | A callback that awaits its own work finishes before the endpoint response. A callback that schedules detached work and returns does not.                         |
| [OTP routes](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/plugins/email-otp/routes.ts#L126-L169)           | Evaluates `sendVerificationOTP(data, ctx)` and passes its result to `runInBackgroundOrAwait`; reset/change-email paths also use that helper.                             | The callback begins synchronously, but its awaited continuation can outlive the HTTP response.                                                                   |
| [Context implementation](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/context/create-context.ts#L385-L408) | Without a background handler, helper awaits the promise; with one, hands off a caught promise without waiting for completion. Errors are logged.                         | An `await runInBackgroundOrAwait(...)` at the endpoint is not proof that callback completion precedes the response. Never put credential data on a thrown error. |
| [OTP plugin hooks](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/plugins/email-otp/index.ts#L47-L123)       | Verification override and optional signup hook use background-or-await too.                                                                                              | Checking only the explicit OTP endpoint misses signup delivery.                                                                                                  |
| [Email/password signup](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/api/routes/sign-up.ts#L371-L398)      | Calls verification sender through background-or-await, passing a cloned request.                                                                                         | Do not depend solely on original `Request` object identity.                                                                                                      |

The [OTP callback type](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/plugins/email-otp/types.ts#L8-L26) recommends not awaiting email sending and exposes optional endpoint context. The [performance guide](https://better-auth.com/docs/guides/optimizing-for-performance#background-tasks) explicitly describes deferred email sending. Native APIs can also be invoked server-side without a browser; [magic-link documentation](https://better-auth.com/docs/plugins/magic-link) and [OTP documentation](https://better-auth.com/docs/plugins/email-otp) show client and server calls.

**Inference:** request-local attribution is viable; response-local delivery is not universally reliable. A thin native callback adapter can snapshot the authorized route immediately and enqueue the small dev record before returning its promise. Under that explicit synchronous-enqueue contract, a response bridge can work for the inspected flows, even when later transport work is asynchronous. It must reject/drop late writes after finalization and cannot claim support for callbacks that invoke the facade after an arbitrary delay.

For general delivery, wrap the call to native `auth.handler(request)` in `AsyncLocalStorage.run` and retain an immutable, expiring route capability in the callback closure. Do not use `enterWith` as a global current-browser variable. [Node’s context documentation](https://nodejs.org/api/async_context.html#class-asynclocalstorage) defines asynchronous scope propagation and context-loss handling. [Bun compatibility documentation](https://bun.sh/docs/runtime/nodejs-compat#node-async-hooks) says ALS is implemented but does not propagate into Worker, MessagePort, or BroadcastChannel events. Explicitly carry and validate a route capability across those boundaries, or declare them unsupported. ALS surviving a response does not keep that response writable and does not survive process death.

## Smallest viable wiring and illustrative flow

Proposed names below describe responsibilities, not settled public signatures. The only optional development declaration might be `stack({ api: true, authDevDelivery: { transport: "browser" } })` in `vite.config.ts`. This does **not** imply zero server auth integration: native required sender callbacks still need a thin adapter or deliberate option composition. Keep native `betterAuth`, `magicLink`, `emailOTP`, options, clients and inference. [Native client fetch options](https://better-auth.com/docs/concepts/client#fetch-options) provide a composition point for request headers; the exact hook and interaction with app hooks still need qualification. Do not patch global `fetch` merely to avoid this small client integration. Do not monkey-patch Better Auth internals from preload to discover auth instances.

```text
stack dev
  owns ephemeral private channel + session generation; starts Compose first
  starts Vite and Bun --watch --preload <Stack dev registration> source entry

Vite configureServer (single optional declaration)
  registers chosen transport through private channel
  installs serve-only browser receiver + per-tab capability endpoint
  acknowledges readiness; unregisters on close/restart

Bun preload
  installs only an inert-until-ready adapter handle before auth imports
  never imports Vite config or application auth and never patches console

native browser auth request
  carries per-tab capability in header, scoped to configured auth path
  -> Vite strips untrusted internal headers and validates origin/capability
  -> adds authenticated internal route envelope while proxying to Bun
  -> thin handler wrapper establishes request-local immutable route
  -> native Better Auth sender adapter selects app sender or dev fallback
  -> dev callback snapshots route, emits typed record over private channel
  -> Vite puts record in bounded per-capability mailbox
  -> only that tab polls/streams its mailbox and prints plain console data

stack build
  Vite serve hooks absent; Bun build never evaluates auth configuration
  built entry imports inert built-lock guard before application imports

built app (including NODE_ENV=development)
  lock denies all dev adapter access; only app sender can deliver
  missing required app sender -> startup diagnostic before listener
```

Backend startup must wait for an explicit Vite registration/no-transport result before accepting fallback-dependent auth configuration. Both children currently launch concurrently in effect; no assumption that Vite is ready first is safe. Let the CLI broker readiness and pass an ephemeral private descriptor to children; do not scrape stdout. Use an authenticated local socket/pipe or similarly private channel, not a public unauthenticated HTTP ingest route. This keeps one dev declaration, without teaching the production backend to load Vite or serializing arbitrary config functions.

Prefer native child IPC for the first qualification spike: [Bun documents](https://bun.sh/docs/runtime/child-process#inter-process-communication-ipc) parent `.send()`, child `process.send()` / `process.on("message")`, and JSON or structured-clone serialization. The existing CLI can broker typed messages between its children without another process or public network endpoint. Keep payloads plain bounded JSON regardless of serializer. The current `node:child_process.spawn` helper does not request an IPC fd; adapting it and verifying fd survival/reconnection under `--watch`, Vite config restart, and process-group shutdown are qualification work, not established behavior. If native IPC cannot preserve this lifecycle cleanly, use the private reconnectable socket described above rather than replacing native watching with custom source rewriting. Neither serialization mode transfers arbitrary functions or request-local async context.

A developer-supplied custom transport callback (for example Mailpit delivery) can execute in Vite’s process and receive typed records through this channel. It must not become a serialized function in environment variables. Application production callbacks execute normally in the backend. A transport requiring backend-local objects needs a separately designed module-reference contract; do not promise arbitrary closure transfer between processes.

### Browser isolation and lifecycle rules

These are proposed protocol requirements, not claims that Vite or Better Auth supplies them automatically:

- Generate a cryptographically unguessable, per-tab capability at handshake. Bind it to the dev-session generation and expected origin. Put it in memory; carry it only on the relevant native auth fetches using a supported fetch hook. Do not key delivery by email, IP address, unauthenticated request ID, or whichever browser connected most recently.
- Vite must authenticate/replace internal proxy metadata; the backend must reject forged or missing envelopes on the dev path, including direct requests to its listening port. Loopback binding alone does not attribute a tab. Validate origin on capability issuance/read endpoints and avoid capabilities/credentials in URLs or access logs. Separate tabs must not subscribe to one shared mailbox.
- Never use a global `server.ws.send(...)`, shared SSE stream, broadcast channel, or console pipe for credentials. A multiplexed channel is acceptable only if server-side authorization targets one capability. Client-side filtering of a broadcast is not isolation.
- Capture route at callback entry. Retain it across awaited work with a strict expiry; late/expired/unattributed callbacks fail closed with a credential-free diagnostic. Server-only native calls have no browser unless an explicit authorized route is supplied. Do not route a background job by its recipient email.
- Bound per-tab queue length, message size and retention; remove on acknowledgement/expiry. Do not persist credentials to disk. Reject delivery after the auth credential’s expiry even if the mailbox TTL is longer. A dropped response or reconnect must not reassign records to another tab.
- A backend watch restart reinstalls preload and drops in-memory background work. Vite restart rotates generation and discards mailboxes; surviving browsers re-handshake. Never replay old credentials to newly registered capabilities. Delivery is best-effort in development: after a restart the user retries the auth action.
- Config changes must revoke the old registration, not leave the previous adapter active. Shutdown closes the private channel and clears queues along with the CLI’s existing process-group cleanup. Readiness needs cancellation/timeout diagnostics, rather than hanging startup indefinitely.

This protocol still assumes the dev origin’s application code is trusted: any script executing in the requesting tab can observe its credentials. That is intrinsic to the requested browser delivery, not a reason to distribute them to unrelated clients.

### Logs, imports, senders and build behavior

Use a tiny allowlisted record (`kind`, flow, recipient, OTP or link, correlation, expiry), rather than arbitrary console arguments. Validate/serialize it as data; never execute it or inject it into HTML. Bound strings and JSON size. Exclude request headers, session objects, cookies, stacks and arbitrary metadata by default. Credentials go directly to the private delivery channel; no `console.log`, evlog context, drain, stdout framing, or persistent log fallback.

This matters in this repo: [`src/logger/elysia.ts`](../../src/logger/elysia.ts) enables file persistence outside production by default, [`src/logger/persistence.ts`](../../src/logger/persistence.ts) writes JSONL, and [`src/cli/output.ts`](../../src/cli/output.ts) forwards labeled lines. Redaction is application-owned under ADR 0009. Reusing those paths for auth secrets creates durable copies and makes parsing ordinary formatted logs a transport protocol.

Keep server runtime imports free of Vite, CLI, preload and active transport imports. Browser client entry points must have no runtime import of server auth configuration; type-only inference imports remain appropriate. An explicit `browserLog` facade can reuse targeting later for ordinary diagnostics, but auth needs typed delivery status and missing-sender validation rather than an unobservable no-op.

Recommended sender precedence: an application callback remains authoritative in every mode. Dev transport fills only missing callbacks for opted-in native flows; do not silently duplicate production sends or replace callbacks because the process is developing. No transport registration means no dev fallback. Transport failure must not fall back to printing credentials. Exact helper names remain open.

Builds must not instantiate auth, resolve transport readiness, or validate production senders. Perform required-sender validation at actual auth startup, before listening, independently of `NODE_ENV` when the built lock is present. Report the enabled flow and native option to supply. Thin adapter construction can register requirements for the startup gate; standalone native use needs an explicit validation/integration point. Stack cannot promise to introspect every arbitrary application callback or plugin. The helper must not throw just because a build loads Vite config containing the dev declaration.

## Qualification gates before adoption

No runtime implementation was added. Before settling signatures, qualify these specific boundaries:

1. Build a dev-only-configured app without deployment senders; inspect client assets and backend graph for active transport references. Start built output directly with `NODE_ENV=development`; verify no delivery endpoints, browser injection or credential output, and an actionable missing-sender startup failure.
2. Repeat with a valid app sender and confirm it works under both modes without importing dev transport. Test stale dev environment descriptors and custom export conditions; built locking must remain authoritative. Exercise static server imports before `startServer` and multiple module instances.
3. Test native OTP, magic link, signup verification and direct server API calls. Enable Better Auth background handler; delay a callback beyond the HTTP response; require delivery only to the originating capability or an explicit failure. Do not merely test a synchronously invoked `console.log`.
4. Use two tabs, two browser profiles, concurrent requests, an unknown capability, a forged internal header, and a direct backend call. No unrelated browser may receive a credential or list another mailbox.
5. Restart Bun and Vite separately; change config; stop during handshake/delivery. Verify generation rotation, bounded queues, no replay, no orphan process/channel, and credential-free diagnostics and persistent logs.

The temporary probes establish native build/runtime behavior only. They do not qualify a future channel’s security, Vite fetch-hook integration, sender validation or background delivery end to end. The remaining design decision is whether to accept the general mailbox bridge, or deliberately narrow the first version to synchronous response delivery with its limitations stated publicly.

## Validation of this research change

`bun --bun vp check` and `bun run example:check` passed. `bun --bun vp test` reported 717 passing tests and one 5-second timeout in the database-command help/local-operations test; that exact test passed when rerun alone (3.31-second run). No runtime changes were made to address that unrelated timing failure. Only this Markdown file was authored for this assignment; probes used temporary external files.
