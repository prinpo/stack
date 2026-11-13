# Auth development delivery through Vite

Research for the Auth Block design interview, inspected 2026-11-11. **Proposed design, not an implementation or accepted ADR.** Scope: Vite, Bun, Better Auth, and maintained first-party comparisons outside TanStack/Next. No runtime code, manifests, or lockfiles changed; no agents delegated.

## Recommendation

Let **Vite host the browser relay**, using a development-only plugin, middleware, and targeted custom HMR messages. Let `stack dev` own the session and launch the Bun backend with a native development preload. Keep production delivery callbacks in normal application configuration, independent of Vite. Do not create another HTTP server solely to repeat Vite's existing lifecycle and browser connection.

This is feasible using native hooks, but Vite provides transport primitives, not private mail delivery. Stack must supply capability validation, request correlation, expiry, and backend wiring. A small independent relay is justified later if delivery must survive Vite restarts, operate without Vite, or serve multiple independently launched backends. None is required by the current single-origin browser development scope.

The difficult boundary is the backend, not printing to the console. A Vite plugin alone cannot exclude backend development behavior from Stack's externalized Bun build. Prefer a dev-launch-only preload with **no import from the ordinary server graph to the relay implementation**. Do not claim that `NODE_ENV`, Vite mode, conditional exports, or browser dead-code elimination proves server exclusion.

## Project constraints and evidence

Read before exploration: root `AGENTS.md`, `CODING_STANDARDS.md`, `GLOSSARY.md`, `docs/agents/domain.md`, Auth milestone, and ADRs 0002, 0003, 0008, 0009, 0010, 0015, 0020.

- [ADR 0002](../adr/0002-compose-independent-blocks-with-native-apis.md) requires independent Blocks and native APIs; [ADR 0020](../adr/0020-use-better-auth-for-the-auth-block.md) and [Auth milestone](../milestones/0007-auth.md) require optional delivery declared once in Vite config, exclusion from built apps regardless of runtime mode, and credential-free builds.
- [Vite integration](../../src/vite.ts) currently configures the API proxy with `changeOrigin: true`, preserving paths. The browser and Elysia run in separate processes.
- [CLI lifecycle](../../src/cli/lifecycle.ts) starts `bun --watch ... src/server/index.ts` and Vite separately; environment edits restart both children. Backend builds use `bun build --target bun --packages external`; build and start have distinct paths. [Process launcher](../../src/processes.ts) uses `node:child_process.spawn`, detached process groups; [tool wrapper](../../src/cli/tools.ts) forwards labeled stdout/stderr. There is currently no delivery IPC channel.
- [ADR 0009](../adr/0009-resolve-deployment-configuration-at-runtime.md) keeps credentials out of builds and resolves configuration before importing application modules. [ADR 0008](../adr/0008-complete-request-logs-after-the-final-response.md) assigns ordinary logging a separate lifecycle. Delivery should not be parsed out of these logs or silently added to their sinks.

Local Bun reports 1.4.4. The manifest pins Vite+ 1.2.0 and aliases `vite` to its core; upstream Vite main is reference evidence, not proof that every newly documented hook exists in that pin. Do not assume the newer `closeServer` hook without checking the installed core; cleanup through the actual HTTP server close event is an alternative needing qualification.

## Verified upstream primitives

Vite's [`configureServer`](https://vite.dev/guide/api-plugin#configureserver) installs middleware before Vite's internal handlers and does not run during a production build. A serve-only plugin can use native HTML injection to add its browser subscriber without rewriting application source. Do not implement delivery in `configurePreviewServer`; preview serves built output. Use the command boundary, not the spelling of the mode.

[Vite's channel documentation](https://vite.dev/guide/api-environment-plugins#application-plugin-communication) shows handlers receiving a client and replying with `client.send`. [WebSocket source](https://github.com/vitejs/vite/blob/39d63b8479c6314caab9b78a05d3aaaf36a86b2c/packages/vite/src/node/server/ws.ts#L345) distinguishes a client's `send`, which writes to one socket, from the server's `send`, which iterates connected clients. Consequently, `server.ws.send('auth:otp', payload)` is unsafe for credentials even when the payload contains a tab ID: every client has already received the secret before filtering. Channel names are namespaces, not authorization.

[Vite proxy options](https://vite.dev/config/server-options#server-proxy) expose a `configure(proxy, options)` hook. [Proxy middleware source](https://github.com/vitejs/vite/blob/39d63b8479c6314caab9b78a05d3aaaf36a86b2c/packages/vite/src/node/server/middlewares/proxy.ts) calls this during proxy construction and forwards matched requests. This can attach trusted development request metadata; it cannot observe an email sender's arguments or independently generate the OTP.

Better Auth's [magic-link source](https://github.com/better-auth/better-auth/blob/262adc0e76969fe04ef9355d1c77972bd5f0a1a8/packages/better-auth/src/plugins/magic-link/index.ts) defines native `sendMagicLink(data, ctx?)` with URL/token and calls it with endpoint context. [OTP types](https://github.com/better-auth/better-auth/blob/262adc0e76969fe04ef9355d1c77972bd5f0a1a8/packages/better-auth/src/plugins/email-otp/types.ts) expose `sendVerificationOTP(data, ctx?)`. [OTP routes](https://github.com/better-auth/better-auth/blob/262adc0e76969fe04ef9355d1c77972bd5f0a1a8/packages/better-auth/src/plugins/email-otp/routes.ts#L166) invoke senders through `runInBackgroundOrAwait`. Preserve these APIs; native context is the preferred source of correlation, and delivery cannot assume an open HTTP response. Context is optional in the type, including for direct/server usage.

## Transport alternatives

| Alternative                           | What it contributes                                                                                                     | Limitations                                                                                                                                                       | Assessment                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Vite middleware + custom HMR          | Existing browser connection, one origin, targeted client replies; backend can publish through an authenticated endpoint | Requires registration, correlation, backend ingress, cleanup; shared send broadcasts                                                                              | Recommended default, with individual client sends only                              |
| Vite middleware + private SSE/polling | Explicit per-page stream or capability-bound mailbox; avoids coupling to HMR reconnect details                          | Adds another browser connection and reconnect/queue protocol; still needs backend ingress                                                                         | Reasonable fallback if HMR targeting proves unstable in pinned Vite+                |
| Vite proxy hooks                      | Stamps an already correlated API request; can strip untrusted headers and observe response metadata                     | Not a delivery channel after response completion; no credentials unless backend deliberately exposes them                                                         | Useful adjunct, not the complete solution                                           |
| Small standalone relay server         | Stable owner outside Vite; supports backend-only tooling and arbitrary launchers                                        | Another listener, address, authentication boundary, readiness handshake, shutdown and restart policy                                                              | Defer until these independent capabilities are required                             |
| Request-bound response transport      | Returning to the originating request naturally isolates that response                                                   | Requires backend response mutation and browser interception; headers have size limits; JSON changes native response shapes; cannot deliver after response commits | Possible narrow synchronous option; unsuitable default for OTP/background callbacks |
| Explicit `browserLog(target, value)`  | Avoids intercepting global console; reusable opt-in API                                                                 | Still needs transport, context, serialization, and build exclusion; targetless calls cannot safely pick a browser                                                 | Useful small internal primitive; defer a general public logging Block               |

The table's evaluations are design inferences from the linked primitives, not upstream guarantees of a Stack integration.

### First-party comparisons outside TanStack/Next

**Nuxt:** its [3.11 announcement](https://nuxt.com/blog/v3-11) describes request-associated server logs. Current [Nitro plugin source](https://github.com/nuxt/nuxt/blob/6a289ccf8f7631ea42f42910a5e81f5b33dfefb2/packages/nitro-server/src/runtime/plugins/dev-server-logs.ts) creates asynchronous request context, wraps console through Consola, collects logs, and serializes them with `devalue` into the rendered HTML. Its [client plugin](https://github.com/nuxt/nuxt/blob/6a289ccf8f7631ea42f42910a5e81f5b33dfefb2/packages/nuxt/src/app/plugins/dev-server-logs.ts) revives those values and emits a hook. Borrow request association and explicit serialization. Do not copy console interception or assume SSR HTML delivery covers subsequent Elysia JSON requests or callbacks after rendering. Stack is not using Nuxt's request/render host.

**Astro:** the [Dev Toolbar API](https://docs.astro.build/en/reference/dev-toolbar-app-reference/#client-server-communication) uses server hooks and Vite for communication. Its [actual helper](https://github.com/withastro/astro/blob/d68e4f6340409a201df7c5f77d5d322abfe6c377/packages/astro/src/integrations/hooks.ts#L121) calls `server.environments.client.hot.send(event, payload)` without selecting a client. Borrow the tooling lifecycle and native channel, not its shared-send policy for credentials. Astro's convenience helper is not an auth-private transport.

Neither is a drop-in Better Auth development email solution. Their source supports assembling a small adapter rather than adopting an SSR framework or generic console forwarding package.

## Minimal private correlation protocol — proposed

1. Each injected page client registers on its own HMR connection before auth requests are sent. The relay returns a random, unguessable page capability **only to that connection**, scoped to a fresh development-session epoch. Treat it as a secret, not a public tab label. Keep it in page memory initially; no shared local storage, browser-wide cookie, BroadcastChannel, or email-indexed lookup. Full reload obtains a new capability; losing pending deliveries on reload is an acceptable initial limitation. A duplicated tab must register independently.
2. Browser requests to the configured auth prefix carry that capability and an independent request ID. A public request ID alone is insufficient authorization. A native Better Auth fetch hook can add headers without changing headless auth methods; alternatively, the dev-injected module can wrap same-origin fetch restricted to the auth prefix. The latter preserves one Vite declaration but is still global interception and needs explicit qualification. A Vite proxy cannot infer which tab sent otherwise identical HTTP requests: automatic per-tab delivery requires one of these browser mechanisms. Do not disguise that constraint.
3. Before proxying, Vite validates the capability against the live connection, origin and epoch; removes any browser-supplied internal correlation headers; then supplies a short-lived trusted delivery reference to Bun. Bind reference to request, project/session and target connection. Backend must authenticate proxy/relay metadata (for example a MAC with the process-session secret); direct backend requests with forged headers must not become trusted browser destinations.
4. At the sender callback, capture this validated delivery target from native endpoint context immediately, before scheduling asynchronous work. Publish a small envelope containing epoch, delivery/request ID, purpose, recipient, and exactly the OTP or URL needed. A separate backend publishing credential authenticates ingress. A browser page capability must never authorize publishing arbitrary credentials to another tab.
5. Vite resolves the reference and sends only to the originating client. If absent, disconnected, expired or from an old epoch, drop safely with a diagnostic containing no secret. Never fall back to all clients, the last active tab, matching email, or terminal printing. Start without credential replay; bounded retry/deduplication can address a lost publication acknowledgement, but a socket send is not proof the developer saw it.

Per-tab capability plus request ID is sufficient; user identity is unnecessary and unavailable before login. Exact one-use reference rules need to allow several messages from one auth operation. A short-lived connection/reference map is enough initially; no durable mailbox or database migration is needed. An already authorized same-origin app script or local machine administrator remains inside this development trust boundary; this protocol does not protect against same-origin XSS.

Validate origin/host explicitly for sensitive relay middleware; do not assume middleware inserted before Vite's internal stack inherits later checks. [Vite host documentation](https://vite.dev/config/server-options#server-allowedhosts) explains the DNS-rebinding risk. Reject wildcard credential ingress, restrict methods/content types/body size, set `Cache-Control: no-store`, and keep capabilities out of URLs/access logs. HMR's own connection token is not a per-tab mail authorization policy.

## Bun/Vite communication and lifecycle — proposed

The least process coupling is **Bun preload → authenticated HTTP POST → Vite middleware → selected HMR client**. Use loopback ingress by default, verify the backend publisher secret, and never expose it through injected HTML. Vite's actual listening address must be communicated after readiness rather than guessed from default ports. If browser access uses HTTPS, it does not follow that Bun can ignore certificate verification; qualify the loopback publication address separately.

`stack dev` owns the epoch/secret and both child lifetimes. The Vite plugin owns connection maps and custom-delivery callbacks. A native `--preload` runs before application imports ([Bun runtime](https://bun.sh/docs/runtime#dependency-module-resolution)); it installs a narrow delivery provider used by ordinary Stack auth helpers. It must not import the application or Vite config into Bun's backend. Custom Vite callbacks stay in the Vite process, avoiding serialization of closures and their configuration dependencies.

For the readiness handshake, two viable native choices are an inherited IPC channel or a private Unix socket/control file containing endpoint metadata. Prefer trying IPC first: [Bun IPC](https://bun.sh/docs/runtime/child-process#inter-process-communication-ipc) supports `process.send` and parent handlers; JSON keeps the control protocol explicit. However, Stack currently uses `node:child_process.spawn`, so its stdio configuration must deliberately include IPC. Bun `--watch` and Vite+ child-launch behavior need a spike before promising transparent readiness/reconnect. No stdout parsing: labeled ordinary output is not a private protocol.

After a Vite restart, rotate epoch/capabilities, reject old publications, and re-register pages. Parent-coordinated restart/rebootstrap of Bun is simpler than retaining stale publisher state. A backend-only watch restart reinstalls the preload and keeps the current session metadata if Vite has not restarted. Kill/drain listeners and clear credential references on shutdown. [Bun watch documentation](https://bun.sh/docs/runtime/watch-mode) distinguishes hard process restart from hot reload; do not store required state only in a backend module global across watch restarts.

Delayed callbacks remain valid only while their captured target/epoch is alive and unexpired. [AsyncLocalStorage](https://nodejs.org/api/async_context.html#class-asynclocalstorage) can support request-local convenience, but cannot reconstruct a target for a new worker/job/process. [Bun compatibility notes](https://bun.sh/docs/runtime/nodejs-compat) specifically exclude propagation into certain worker/message events. Background jobs must carry an explicit target or use custom delivery. Jobs surviving a process/session restart deliberately lose console delivery; Mailpit is the better durable development inbox.

## Build and runtime exclusion — proposed acceptance contract

Separate three graphs: Vite configuration/tooling; dev-only backend bootstrap; normal auth runtime. Production runtime imports neither Vite nor the relay nor custom dev senders. The normal sender adapter may consult a narrow registered-provider slot, but must not discover/import a provider from `NODE_ENV`, an environment URL, or a conditional dynamic import. Only `stack dev`/an explicit development launcher installs it.

This prevents activation merely by running built output with `NODE_ENV=development`. For stronger fail-closed behavior, make the provider registry refuse use for built entries, and clear inherited dev metadata on `stack start`. Stack already uses a native build banner for database lifecycle, but an entry-body banner is not automatically early enough: static ESM dependencies can evaluate before that body. A banner marker can guard later dispatch only if neither registration nor imports perform delivery side effects. If an earlier guard is required, use a build-owned entry/bootstrap that marks the artifact and then dynamically imports the application through native Bun entry composition; qualify that additional build boundary. The marker supplements graph exclusion; an environment flag alone is not the exclusion mechanism. Reject unsupported direct dev preload of built entries too. Qualification must verify evaluation order with externalized imports, not assume it.

[Bun externalization](https://bun.sh/docs/bundler#external) retains package imports for runtime resolution. Thus a custom `development` export condition can be selected again at runtime; it is not an artifact guarantee under `--packages external`. A browser virtual module cannot resolve a Bun server import. Native Bun `onResolve`/`onLoad` [plugins](https://bun.sh/docs/runtime/plugins) are an alternative for a narrowly controlled import seam, but are unnecessary complexity if the preload can install the provider; do not rewrite callback source or patch Better Auth internals.

Never load a custom sender, connect to Vite, require a running relay, or validate production email credentials during build. The Vite factory must also be inert when its config is imported for build; serve-only hooks do not undo factory side effects. At runtime startup, after auth configuration exists but before listen, enabled email flows without an app production sender or authorized dev provider must fail with an actionable message. Do not postpone this to the first login or throw while a schema generator merely imports auth configuration.

Important limit: with externalized Stack dependencies, “excluded” means unreachable from supported built startup, not deletion of every dev source file from installed `node_modules`. Physically removing it from deployment dependencies would require separate packaging. No JavaScript library can prevent an operator from deliberately importing arbitrary dev tooling and altering the process; the required guarantee should cover supported built entry points and runtime mode changes.

## Developer API sketch — proposed, names unsettled

```ts
// vite.config.ts — the only declaration of development delivery
export default defineConfig({
  plugins: [stack({ api: true, authDev: { delivery: "browser" } })],
});

// Alternative declaration in that same location:
// authDev: { delivery: async (message) => mailpitSender(message) }
// Callback executes in Vite, never the browser or production auth runtime.
```

The ordinary server configuration still declares native Better Auth methods/plugins and application production callbacks. A possible Stack helper supplies native-shaped callbacks while retaining the app sender as fallback:

```ts
// Conceptual only; these exports do not exist.
const delivery = authDelivery({
  sendMagicLink: appSendMagicLink, // optional during initial dev work
  sendVerificationOTP: appSendOTP,
});
const auth = betterAuth({
  plugins: [
    magicLink({ sendMagicLink: delivery.sendMagicLink }),
    emailOTP({ sendVerificationOTP: delivery.sendVerificationOTP }),
  ],
});
```

The helper is ordinary sender integration, not a second dev configuration. Precedence proposed: explicitly enabled dev provider replaces only sends routed through this helper; otherwise call the corresponding app sender unchanged. No duplicate sends by default. Direct native callbacks remain entirely application-owned. A browser delivery request lacking correlation fails explicitly; it does not silently send via production or leak to the terminal. Custom inbox delivery can accept uncorrelated server calls. Decide startup validation registration separately; this sketch does not imply that merely constructing these two callbacks enables both flows.

An optional future `browserLog(target, ...jsonValues)` should use the same targeted provider, explicitly return unavailable/dropped status outside it, and never silently broadcast. Auth should use a typed delivery envelope internally instead of treating the OTP as an arbitrary log argument. Serialize JSON-safe strings/records with limits; avoid `Request`, cookies, authorization headers, whole auth contexts, circular objects, `BigInt`, arbitrary error objects, and implicit object inspection. Print text/URL arguments directly in the requesting browser; do not revive executable values or render HTML. Ordinary server logs remain unaffected.

### Custom delivery and standalone wiring

[Mailpit SMTP](https://mailpit.axllent.org/docs/configuration/smtp/) defaults to port 1025 with no authentication/encryption; app-owned development SMTP or its [send API](https://mailpit.axllent.org/docs/api-v1/) can serve as the Vite callback. The shared Mailpit inbox has its own access policy and is not per-tab private. Selecting it should not simultaneously send credentials to browser clients. The existing Compose lifecycle can start Mailpit without making Docker an Auth prerequisite.

`vp dev` alone can host the relay but cannot retroactively alter a separately running Bun process. Standard `stack dev` must arrange the preload automatically. For manual/standalone development, offer a documented dev launcher wrapping the same native preload and handshake (or a low-level bootstrap entry); it is a launch instruction, not another application declaration. Do not make applications copy tokens/ports into committed config. Backend-only applications can use native app-supplied Mailpit senders now; a generic relay server is warranted only if a browser-console workflow without Vite becomes a real requirement.

## Qualification required before choosing the implementation

- Verify installed Vite+ targeted HMR, HTML injection order, listener disposal, config restart, and HTTPS/proxy behavior. Register delivery before the browser's first auth request; qualify whichever browser header hook preserves the one-declaration requirement.
- Exercise concurrent OTP/magic-link sends from two browsers and two tabs, duplicate tabs, forged/expired references, direct backend requests and delayed sends. Assert unrelated clients receive **no payload**, not just no console output.
- Exercise immediate and deferred native senders, server APIs with missing context, workers, disconnects, backend watch restart, Vite restart and full shutdown. Specify drops and retries; do not promise durable delivery.
- Build with only dev delivery configured and no running relay or email secrets. Start built artifacts with development mode and inherited stale dev metadata; verify no provider activation, routes, injected subscriber, imports of relay tooling or custom callback execution. Validate startup failure for enabled email methods lacking production delivery, while a schema-only import remains usable.
- Qualify Bun native preload/build-banner ordering with externalized packages and normal `stack start` plus direct built-entry startup. Static artifact string checks alone cannot inspect behavior hidden behind retained package imports.
- Confirm production senders work without Vite and remain unchanged when dev delivery is absent. Confirm no credentials enter CLI stdout/stderr, request logs, error serialization, control files, source maps, or shared HMR error buffers.

These are implementation acceptance cases, not tests executed by this research. The remaining design decisions are the automatic browser header seam, startup-validation ownership, exact supported manual launcher, and whether losing pending deliveries on reload is acceptable. None requires selecting a standalone relay server now.
