# Auth development console: upstream investigation

Research date: 2026-11-11. Design research only; no runtime implementation or dependency changes.

## Recommendation

Use an explicit, recipient-bound `browserLog` capability as the foundation for optional Auth Block development delivery. Reuse native Vite development hooks and Bun preloading/process orchestration; do not adopt TanStack's global console interception or its broadcast transport for OTPs or magic links. Next.js provides a useful request-association model, but its React Flight implementation is not a standalone Bun/Elysia transport.

The optional declaration should live once in Vite configuration. Its factory must be safe to evaluate during builds. Only development-server hooks should create the browser client, delivery transport, or backend registration. `stack dev` must arrange backend initialization before application imports. The ordinary server/auth graph must not import the development delivery implementation. This is a proposed design, not a demonstrated integration.

Do not use `NODE_ENV`, browser dead-code elimination, or conditional package exports as the sole exclusion mechanism. Stack externalizes server packages: Vite never transforms those backend imports, and external packages remain runtime imports. The production-sender path must work independently of the development plugin.

These recommendations implement the constraints in [the Auth milestone](../milestones/0007-auth.md) and [ADR 0020](../adr/0020-use-better-auth-for-the-auth-block.md), consistent with [native independent Blocks](../adr/0002-compose-independent-blocks-with-native-apis.md), [separate dev processes](../adr/0003-vite-plus-and-bun-with-a-single-public-origin.md), [credential-free builds](../adr/0009-resolve-deployment-configuration-at-runtime.md), and [CLI lifecycle ownership](../adr/0010-own-application-commands-through-the-stack-cli.md). No ADR change is proposed.

## Evidence and scope

Read `AGENTS.md`, `CODING_STANDARDS.md`, `docs/agents/domain.md`, root `GLOSSARY.md`, Auth milestone, and relevant ADRs before exploring. Also inspected request-logging ADR 0008 and development-orchestration ADR 0015. User instructions require this research agent to work alone, overriding the research skill's usual delegation workflow.

Inspected official documentation, npm registry metadata and published source, plus GitHub source snapshots:

- [`@tanstack/devtools-vite` 0.8.6 metadata][npm-vite], with `@tanstack/devtools-bundler-core` 0.1.4 and `@tanstack/devtools-event-bus` 0.4.3. Their published tarballs include source. The inspected Vite plugin and console generator exactly matched Devtools commit `8f625443bfde9c5ec6415f05958020aecb252d8d`.
- TanStack Router/Start repository commit [`113b1a1f08e330ff8c7dca5a0d419772035050ba`][start-root]. Registry `@tanstack/react-start` latest was 1.169.5. Repository-head findings are not asserted to describe every older Start release.
- Next.js canary commit [`2b3634d476b34c9c639f5430ad341efd8186011c`][next-root], including its vendored React Flight development and production files. Registry `next` latest was 16.4.6; the inspected canary is a separately identified snapshot, not assumed identical to that release.
- Better Auth 1.7.21 published files and matching tagged source for magic-link and email-OTP callbacks.

This was source inspection, not a Bun compatibility or multi-browser transport qualification. Downloads stayed under `/tmp/auth-console-research`; project manifests and lockfiles were untouched.

## Resolve the TanStack name correctly

`@tanstack/devtools:console-pipe-transform` is a **Vite plugin object's `name`**, not an npm package or public import subpath. Install/use `devtools()` from `@tanstack/devtools-vite`. Its export map exposes only the root and `./package.json`. `@tanstack/devtools` is a separate package, not the console-transform import. The generator is exported from the root of `@tanstack/devtools-bundler-core`; there is no exported console-pipe subpath there either. [Package metadata][npm-vite], [core metadata][npm-core], [Vite plugin source][ts-plugin].

The official architecture documentation describes both console piping and the event bus. They are distinct mechanisms in the inspected source; do not infer that console forwarding uses the event-bus WebSocket just because both ship with `devtools()`. [Official architecture][ts-architecture], [console middleware][ts-utils].

## TanStack console piping in depth

### Injection and transport

The transform runs with Vite `command === 'serve'`, `mode === 'development'`, and enabled console piping. It prepends generated JavaScript to heuristic entry matches: HTML JSX, `StartClient`, `hydrateRoot`, `createRoot`, or Solid rendering. It skips dependencies, dist, and queried module IDs. It therefore needs an entry in Vite's transformed graph; it is not a Bun loader hook. [Transform source][ts-plugin].

The generated runtime patches configured global console methods, retains normal output, and uses an initialization flag per runtime. Server logs batch for 50 ms or 20 entries; browser logs for 100 ms or 50 entries. Server batches POST to Vite's `/__tsd/console-pipe/server`; browser batches POST to `/__tsd/console-pipe`. Browser replay subscribes to `/__tsd/console-pipe/sse` and calls saved console methods to avoid feedback. Network errors are swallowed; there is no acknowledgment/retry queue for server delivery. [Generator][ts-console].

Vite middleware manages SSE connections and loops over **all** of them for each server batch. Connection IDs only support connection removal; they are not message recipients. The SSE endpoint allows `Access-Control-Allow-Origin: *`. Console POST handlers collect a JSON body without an explicit size limit or origin/token validation in that handler. Entries have no request/browser target. [Broadcast implementation][ts-plugin], [HTTP handlers][ts-utils].

The generated server origin is `http://localhost:${port}` in this Vite implementation. Its console transport does not inherit the separate event-bus HTTPS configuration. Treat HTTPS, remote development, containers and reverse-proxy origins as limitations requiring qualification, rather than assuming event-bus settings fix console POST delivery. [Vite injection source][ts-plugin], [connection distinction][ts-connection].

### Serialization and lifecycle

The serializer snapshots objects rather than preserving live console inspection. It handles cycles, Error fields, dates, bigint and several browser objects, with depth 6, 100 array elements/object keys, and 10,000-character string limits. Bigints/functions/symbols become display strings; unsupported values lose fidelity. Accessors can execute during serialization. Interception calls the original console first, so credential logs still reach the terminal. [Serializer and wrappers][ts-console].

Design implications for Stack:

- Forwarding all console output would expose unrelated logs and credentials, duplicate existing request logging, and impose serialization work on third-party output. Filtering console levels cannot establish recipient isolation.
- Injection is not guaranteed to precede imported modules' evaluation: a textual prefix in an ESM entry does not run before its static dependencies. Startup output can precede installation.
- A delayed callback is forwarded wherever it runs after interception, with no originating-request association. There is no safe fallback from missing association to broadcast.
- The SSE subscriber set and pending batches are memory-only. Disconnected recipients miss events; timers/batches can disappear on backend restart. EventSource reconnection is not event replay: these messages carry no replay IDs or durable history.
- HMR initialization flags prevent repeated wrapping, but do not define teardown or credential retention policy. General logging convenience is a different reliability contract from credential delivery.

These are consequences of the inspected generator/middleware, not claims of upstream security promises. [Runtime][ts-console], [middleware][ts-plugin].

### Separate event bus and isolated runtimes

`ServerEventBus` uses Node HTTP plus `ws`, defaults to localhost:4206, and exposes `/__devtools/ws`, `/__devtools/sse`, and `/__devtools/send`. It can attach to a compatible external HTTP server; the Vite plugin does so for HTTPS. Its `start()` checks runtime `NODE_ENV === 'development'`. `emitEventToClients()` sends to every WS and SSE connection; `pluginId` is not a browser authorization boundary. [Event-bus server][ts-bus].

The browser bus additionally synchronizes events across tabs with BroadcastChannel. Replacing console messages with custom typed EventClient events does **not** by itself solve confidentiality. [Official architecture][ts-architecture].

A newer runtime bridge handles isolated server environments through their Vite `import.meta.hot` channels, forwarding events to the Vite process's global event target. It is injected into the EventClient implementation in non-client Vite environments. Independent `bun --watch src/server/index.ts` does not acquire those Vite environment channels automatically. [Bridge source][ts-bridge].

### Production behavior

The console transform's serve-command gate prevents injection during a Vite build even with development mode selected. A separate build transform removes recognized Devtools imports/JSX from Vite-processed application modules by default. This is scoped to Vite's graph, not a general server-package exclusion guarantee. The generated console IIFE itself has no production-mode kill switch; manually including it elsewhere would install wrappers there. The event-bus server's runtime environment check is likewise insufficient for Stack's built-app requirement. [Vite gates/removal][ts-plugin], [generated runtime][ts-console], [event-bus startup][ts-bus].

## TanStack Start: what the framework supplies

The console transform explicitly recognizes Start's shared root/`StartClient` shape. When a framework runs the root through Vite on the server and browser, one injection mechanism can install both wrappers. The runtime comments mention Nitro/Vinxi. This explains the apparent seamless Start behavior; it does not imply request-targeted forwarding. [Transform][ts-plugin], [runtime][ts-console].

The inspected Start example uses `tanstackStart()`, React and `nitro()` within one Vite configuration; Start's development server plugin loads the server entry with a Vite environment runner. Stack instead starts Bun and Vite independently. I did not find a separate general console-replay transport in the inspected Start core server/client packages; this is a bounded source-search finding, not proof covering every integration or experimental RSC feature. The basic example itself does not enable the Devtools Vite plugin. [Start example][start-example], [Start dev server][start-dev], [Start server core][start-server].

**Reusable:** the general server POST → Vite middleware → browser replay pattern can cross process boundaries using fetch. **Not automatically reusable:** injection into Stack's Bun process, framework HMR channels, or secure browser targeting. Reusing the generator would still mean global console interception, and reusing the handler would still require replacing its broadcast policy.

## Next.js: request-associated Flight replay

Next.js App Router renders a React Server Component payload and carries it to the browser; this is a framework transport, not an Elysia HTTP-console facility. [Official component architecture][next-docs].

In the inspected vendored React development server, `patchConsole()` resolves the current React request through the current request or AsyncLocalStorage, serializes console method/stack/owner/environment/arguments, and queues `:W` debug rows on that request. It still calls the original console. Without an active React request, that wrapper does not attach a replay record. [Flight server development source][next-flight-server].

The browser decoder processes console records on its response object and replays them when console replay is enabled. Next's render/fetch paths wire Flight and, where applicable, debug streams. Thus replay follows the relevant render response, rather than broadcasting every intercepted message to every browser attached to the dev server. This is request association, **not** a claim that render payloads, prefetches, caches, or shared components form a suitable credential-delivery boundary. [Flight browser decoder][next-flight-client], [server stream integration][next-stream], [browser fetch integration][next-fetch].

The corresponding production Flight server/client files contain no `patchConsole`, `resolveConsoleEntry`, or `:W` replay implementation. This uses distinct development/production implementations. Copying only a `NODE_ENV` guard into an externalized Stack dependency would not reproduce that build boundary. [Production server][next-flight-server-prod], [production browser client][next-flight-client-prod].

Do not confuse this with browser-to-terminal logging or server log files. Next's `receive-logs.ts` receives browser diagnostics; `console-file.tsx` records server console output. Neither is the server-to-browser Flight replay mechanism. [Browser log receiver][next-receive], [server file logging][next-file].

**Reusable idea:** bind output to the request's receiver and propagate that association through async work. **Unsuitable direct dependency:** Next's private/vendored RSC renderer, component ownership metadata, Flight serialization and decoder. React explicitly says framework/bundler RSC APIs can change between minor versions. [React's integration warning][react-rsc]. Detached jobs and callbacks after a response/debug stream closes still require an independent delivery policy; ALS alone does not keep a browser response open or survive process restart.

## Comparison for standalone Stack

| Candidate                      | Separate Bun/Elysia process                                                 | Recipient behavior                        | Built-app boundary                                                 | Assessment                               |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| TanStack console transform     | Needs backend injection outside Vite                                        | All console SSE subscribers               | Serve-only within Vite graph                                       | Useful reference; reject for credentials |
| TanStack typed event bus       | Requires explicit runtime/client setup; Vite worker bridge is not automatic | Server broadcasts; browser cross-tab sync | Runtime dev guard plus Vite stripping where applicable             | Typed events do not fix targeting        |
| Start framework wiring         | Assumes Vite-managed server environment                                     | Console plugin retains broadcast behavior | Framework/Vite build ownership                                     | Do not add Start merely for forwarding   |
| Next Flight replay             | Requires RSC renderer and decoder                                           | Associated Flight/debug response          | Distinct production implementation                                 | Borrow context model only                |
| Proposed explicit `browserLog` | Bun development preload + private relay connection                          | Explicit per-browser/per-flow capability  | No dev implementation import in normal graphs; qualify built guard | Recommended design direction             |

Rows summarize the sources above; the last row is a proposal.

## Proposed Stack boundaries to grill before implementation

### One declaration, native hooks, no source rewriting

1. A development delivery plugin is declared once in native Vite config. Use `apply: 'serve'` and `configureServer` to install middleware and `transformIndexHtml` to insert a development-only client module. Keep the factory inert: no server imports, sender validation, sockets, or secret resolution at config evaluation time. Vite hooks provide these extension points without scanning/replacing application source. [Vite plugin API][vite-api].
2. `stack dev` starts a private supervisor coordination channel before its children. The active Vite plugin registers its delivery configuration after the dev server is ready. Backend readiness must wait for this handshake; no race in which auth initializes before delivery registration. Configuration functions remain in the Vite process; IPC carries validated descriptors/messages, not serialized JavaScript callbacks.
3. Bun's native `--preload` installs the backend bridge before application modules evaluate. A small sender-registration seam may live in the headless Auth Block, but its normal implementation imports no Vite, Devtools, or development browser-delivery module. Dev-only HTTP/IPC transport code belongs only to the preload/config graphs. Bun documents preloading and runtime plugin loading; import hooks are available if qualification reveals a need. Prefer the preload to transforming arbitrary auth files. [Bun runtime][bun-runtime], [Bun plugins][bun-plugins].
4. `stack build` and `stack start` never load that preload, wait for its handshake, or read the dev declaration to configure delivery. Server building already operates separately with `--packages external`; normal server module imports must stay build-safe without a live delivery provider. A build must not execute sender startup validation. [Current lifecycle implementation](../../src/cli/lifecycle.ts), [Bun external packages][bun-build].

These steps require new internal coordination; no existing upstream plugin completes them for Stack. The optional Vite declaration remains the only user-facing development registration. A shared callback seam is an implementation possibility, not a settled public Auth API.

### Exclusion means more than an environment check

With no development implementation reachable from the app's server graph, changing `NODE_ENV=development` cannot manufacture a relay, preload, or browser subscription. Browser injection is serve-only. Do not put a runtime `if (development) import('./dev-delivery')` inside externalized `@prinpo/stack/auth`: that leaves development integration reachable in deployed package source. Do not import a Vite virtual module from the Bun server either: Bun is not running Vite's resolver. [Stack build path](../../src/cli/lifecycle.ts), [Bun bundler][bun-build], [Vite virtual modules][vite-api].

Preload separation alone does not prove that deliberately launching a built entry through development tooling is impossible. If “unavailable in built apps” includes that case, add a build-origin marker executed before server imports, and make bridge registration reject built entries independent of `NODE_ENV`; qualify ordering with external dependencies. An alternative is a native Bun build resolver hook selecting an inert server module, but that must actually cover the relevant imports despite package externalization. Neither option is qualified here. Do not quietly weaken the requirement to “disabled by default.”

A package can still ship dev-tool source for `stack dev` without built applications importing or activating it. If the requirement instead means no dev implementation files anywhere in deployed `node_modules`, separate packaging/deployment pruning is an additional decision. This research establishes execution-graph requirements, not a dependency-file absence proof.

### Credentials need a receiver, not a log level

Proposed transport policy:

- Establish an unguessable per-browser-instance/per-flow receive capability in the dev client. Bind the initiating auth request to that subscription and validate it at the backend/relay. A public request ID, email, shared cookie alone, or plugin ID is not a receive secret. Cookies are shared across tabs, so choose tab isolation explicitly.
- Separate backend publisher authentication from browser receive authorization. Never expose the publisher secret to injected browser code. Restrict origins, validate messages, impose byte/queue limits, and use targeted socket/SSE delivery. If using Vite's HMR connections, use a verified individual client; generic `server.ws.send` broadcasts. Vite supplies custom client/server events, not an auth-credential protocol. [Vite communication API][vite-api].
- Keep targeting metadata out of auth email content and logs. Do not use BroadcastChannel. A legitimate receiver can log its own delivered credential; all other recipients must receive nothing. Do not intercept ordinary application consoles or route credential payloads through existing evlog drains.
- Prefer a small typed string envelope for auth deliveries: purpose, URL or OTP, expiry and correlation. Snapshot immediately; avoid arbitrary object graphs/getters, user-defined serialization and whole request/context objects. Use console arguments as data, never generated/evaluated JavaScript.
- Hold delayed messages only in bounded memory, for a short TTL no longer than the credential's lifetime, keyed by the validated receiver. Define acknowledgment/duplicate behavior. Never put credentials in log files, browser storage, relay diagnostics, or durable replay histories by default.

These are design recommendations addressing broadcast and serialization limitations, not capabilities supplied by the inspected upstream packages.

### Better Auth callbacks, production senders and delayed work

Preserve native `betterAuth`, client methods, plugins and callback types. Better Auth's magic-link sender receives the URL/token payload plus endpoint context; the inspected implementation awaits it. Email-OTP routes call `runInBackgroundOrAwait` around the sender promise. Native server APIs can also be invoked without a browser request. [Magic-link source][ba-magic], [OTP routes][ba-otp], [OTP callback type][ba-otp-types].

Capture a validated delivery target **when the callback is invoked**, before any await, and retain an explicit immutable target in the resulting task. Request-local ALS is useful plumbing; it is not a durable browser identity or a cross-process queue. A background worker needs explicit target propagation. No context, expired target, browser disconnect, or restart must ever fall back to another browser or a global console. Define a metadata-only delivery-unavailable diagnostic and retry guidance; do not print the credential as the failure fallback.

On restart, rotate supervisor/publisher credentials and generation IDs; invalidate stale targets and queues. An OTP may remain valid in Better Auth storage after the development delivery process loses it. Require a fresh request rather than redistributing old credentials to newly connected clients. External jobs carrying a target from a previous generation should be rejected.

Keep application-supplied production callbacks authoritative by default and untouched when the dev declaration is absent. Explicit development override/tee precedence remains a design decision; never silently send both real email and browser credentials. Configuring a dev-only sender must permit builds. For a built server, validate enabled email capabilities and required production senders at startup before accepting traffic, without importing dev configuration or using `NODE_ENV` to grant an exemption. Native plugins require callbacks, so the precise wrapper/registration seam that enables startup validation while preserving inference remains unresolved; do not invent a parallel auth configuration language.

## Unresolved facts and qualification gates

- **Backend installation seam:** prove preload ordering, module identity/shared registry behavior across external package imports, and reinstallation under Bun `--watch`. No live Bun/Elysia integration was run.
- **Strong built-app exclusion:** qualify source and built graphs, including direct built-entry execution with `NODE_ENV=development`, stale relay variables, an active Vite server, and attempted development preload. Choose marker versus native resolver boundary before claiming completion.
- **Single-declaration lifecycle:** establish registration protocol, readiness timeout, Vite config reload behavior, backend restart behavior and custom Mailpit-style callback ownership. A plugin factory invoked during build must remain harmless.
- **Target propagation:** qualify every enabled Better Auth sender path, including server API calls, background execution, organization invitations and flows with no request. Decide whether targetless development sends fail or use an explicitly configured independent transport.
- **Delivery semantics:** decide same-browser multiple tabs, reconnects, short buffering, expiry, acknowledgment, and whether credential logging itself is the final acknowledgment. Never substitute “first connected client.”
- **Network portability:** verify pinned Bun + Vite+ behavior, individual HMR-client identity if used, HTTPS/proxy/container origins, and private publisher-channel isolation. TanStack's localhost HTTP console origin is not qualification evidence for these cases.
- **Acceptance evidence:** later implementation should demonstrate two simultaneous unrelated browsers receiving only their own concurrent OTP/link; delayed delivery after response completion; reconnect/restart invalidation; credential-free builds with dev-only delivery; enabled email flow failing built startup without a production sender; and a real sender working unchanged when the dev plugin is absent. These are proposed checks, not completed tests.

The immediate design decision is whether to accept the explicit targeted channel and preload/coordinator boundary. Upstream implementations support the transport shape, but neither provides the full confidentiality and built-app exclusion contract required here.

[npm-vite]: https://registry.npmjs.org/@tanstack/devtools-vite/0.8.6
[npm-core]: https://registry.npmjs.org/@tanstack/devtools-bundler-core/0.1.4
[ts-architecture]: https://tanstack.com/devtools/latest/docs/architecture
[ts-plugin]: https://github.com/TanStack/devtools/blob/8f625443bfde9c5ec6415f05958020aecb252d8d/packages/devtools-vite/src/plugin.ts
[ts-console]: https://github.com/TanStack/devtools/blob/8f625443bfde9c5ec6415f05958020aecb252d8d/packages/devtools-bundler-core/src/virtual-console.ts
[ts-utils]: https://github.com/TanStack/devtools/blob/8f625443bfde9c5ec6415f05958020aecb252d8d/packages/devtools-bundler-core/src/utils.ts
[ts-connection]: https://github.com/TanStack/devtools/blob/8f625443bfde9c5ec6415f05958020aecb252d8d/packages/devtools-bundler-core/src/connection.ts
[ts-bus]: https://github.com/TanStack/devtools/blob/8f625443bfde9c5ec6415f05958020aecb252d8d/packages/devtools-event-bus/src/server/server.ts
[ts-bridge]: https://github.com/TanStack/devtools/blob/8f625443bfde9c5ec6415f05958020aecb252d8d/packages/devtools-bundler-core/src/runtime-bridge.ts
[start-root]: https://github.com/TanStack/router/tree/113b1a1f08e330ff8c7dca5a0d419772035050ba
[start-example]: https://github.com/TanStack/router/blob/113b1a1f08e330ff8c7dca5a0d419772035050ba/examples/react/start-basic/vite.config.ts
[start-dev]: https://github.com/TanStack/router/blob/113b1a1f08e330ff8c7dca5a0d419772035050ba/packages/start-plugin-core/src/vite/dev-server-plugin/plugin.ts
[start-server]: https://github.com/TanStack/router/tree/113b1a1f08e330ff8c7dca5a0d419772035050ba/packages/start-server-core/src
[next-root]: https://github.com/vercel/next.js/tree/2b3634d476b34c9c639f5430ad341efd8186011c
[next-docs]: https://nextjs.org/docs/app/getting-started/server-and-client-components
[next-flight-server]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js
[next-flight-client]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.development.js
[next-flight-server-prod]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js
[next-flight-client-prod]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.production.js
[next-stream]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/server/app-render/use-flight-response.tsx
[next-fetch]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/client/components/router-reducer/fetch-server-response.ts
[next-receive]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/server/dev/browser-logs/receive-logs.ts
[next-file]: https://github.com/vercel/next.js/blob/2b3634d476b34c9c639f5430ad341efd8186011c/packages/next/src/server/node-environment-extensions/console-file.tsx
[react-rsc]: https://react.dev/reference/rsc/server-components
[vite-api]: https://vite.dev/guide/api-plugin.html
[bun-runtime]: https://bun.sh/docs/runtime
[bun-plugins]: https://bun.sh/docs/runtime/plugins
[bun-build]: https://bun.sh/docs/bundler#packages
[ba-magic]: https://github.com/better-auth/better-auth/blob/v1.7.21/packages/better-auth/src/plugins/magic-link/index.ts
[ba-otp]: https://github.com/better-auth/better-auth/blob/v1.7.21/packages/better-auth/src/plugins/email-otp/routes.ts
[ba-otp-types]: https://github.com/better-auth/better-auth/blob/v1.7.21/packages/better-auth/src/plugins/email-otp/types.ts
