# Jobs workers and transport: BullMQ 6.7.6 / Bun 1.4.4

Researched 2026-11-16. Installed BullMQ is **6.7.6**, Bun runtime is **1.4.4**, Eden is **1.4.9**, and evlog is **2.34.0**. These are the repository pins, not a claim about latest upstream releases. Read the repository instructions, coding standards, domain guidance, glossary, [ADR 0022](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/docs/adr/0022-derive-job-clients-from-bullmq-job-definitions.md), [consumer contract](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/docs/consumer/jobs.md), and existing [assessment](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/docs/research/bullmq-jobs-assessment.md) / [review](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/docs/research/jobs-block-council-review.md). Recommendations below are proposals, not claims that the concurrently changing Jobs Block implements them.

## Recommended surface

Prefer one orthogonal option, `workers?: boolean | readonly (keyof Queues)[]`, defaulting to `true`:

- Default: start all workers and expose the producer client.
- `workers: false`: producer only; create no Workers or child pools.
- `workers: ["utilities"]`: consume selected queue aliases; retain producer access for follow-up jobs.

A dedicated worker entry can simply call `createJobs(...).start()` without starting HTTP. A `role: "all" | "producer" | "worker"` enum plus another queue selector adds states without a present requirement to prohibit producers in workers. Keep lifecycle/deadlines identical across hosts and create QueueEvents lazily for `run`. Definition loading still imports handler dependencies in a producer; eliminating those imports is a separate contract-splitting decision.

For isolation, let an optional queue `processor: URL` identify a module whose **default export is the existing QueueDefinition**. Stack passes its own generic sandbox bootstrap URL to BullMQ and provides that definition URL as bootstrap metadata:

```ts
// utilities.ts — illustrative proposed API
const utilities = defineQueue("utilities", {
  jobs: { formatMessage },
  processor: new URL(import.meta.url),
  worker: { useWorkerThreads: true },
});
export default utilities;
```

Omitting `processor` keeps inline execution; with it, native subprocesses are the default and `useWorkerThreads: true` selects threads. No second handler/schema contract is needed. If the application uses named exports, an explicit export selector can be added later; a default export is the smallest initial convention. Validate the loaded definition's native queue name and requested job name. Never import the application composition entry from the bootstrap: doing so can start nested runtimes or HTTP listeners.

This deliberately reopens ADR 0022's deferred separate-worker lifecycle and result-type mapping; update that decision when adopting these changes. Preserve definition-derived input/output/phases/defaults, the `add`/`run` syntax, and both input-validation boundaries.

## Pinned sandbox behavior and actual Bun probes

[Official sandbox guide](https://docs.bullmq.io/guide/workers/sandboxed-processors); installed [Worker dispatch](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/worker.js:78), [Child](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/child.js:69), [ChildProcessor](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/child-processor.js:26), and [sandbox bridge](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/sandbox.js:1) are the primary evidence.

- A function processor always runs inline. File/URL processing creates a ChildPool; `useWorkerThreads` affects only that branch. Supported string suffixes include `.ts`; a URL must exist locally. A file URL is the clearest portable input.
- Subprocess mode calls `node:child_process.fork(main.js)`; under this Bun runtime its default executable is Bun. Thread mode calls `node:worker_threads.Worker(main-worker.js)`. Each loads the processor with dynamic `import()` and expects a default function.
- BullMQ 6.7.6 already guards absent child stdout/stderr before piping them, explicitly citing Bun's thread behavior. Do not copy an older compatibility workaround into Stack.
- Fork/thread options and inherited `process.execArgv` are passed through. Avoid inheriting development `--watch`/`--hot` behavior or invocation flags accidentally into the child. Do not force a Node executable when processors depend on Bun/TypeScript.
- Bun documents partial [node:worker_threads compatibility](https://bun.sh/docs/runtime/nodejs-compat#node-worker-threads): `resourceLimits`/`trackUnmanagedFds` are ignored, and some execution flags/API methods differ. Qualify Bun's actual behavior rather than promising complete Node parity. Worker threads share a process but have independent module/global state; neither mode receives parent closures, DB clients, loggers, or registry state.

**Executed verification:** temporary scripts only, outside the repository, using the installed CJS ChildPool, sandbox bridge, and their real process/thread entry files. A fake parent Job recorded bridge operations; no Redis server or full integration suite was used.

| Probe                                                                                          | Bun subprocess                             | Bun worker thread                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| TS path and file URL; imported TS dependency                                                   | Passed; different PID, `Bun.version=1.4.4` | Passed; same PID, distinct thread ID |
| Inherited environment / parent global isolation                                                | Env inherited; parent global absent        | Env inherited; parent global absent  |
| Token + AbortSignal; later cancellation                                                        | Passed                                     | Passed                               |
| Native updateData/progress/log bridge                                                          | Messages received                          | Messages received                    |
| Date returned before Redis serialization                                                       | Already string across fork IPC             | Still Date across structured clone   |
| Generic bootstrap → loadServerEnv → import existing queue → schema transform → handler         | Passed                                     | Passed                               |
| updateData stores ISO input but refreshes Date handler view; progress defaulting; createLogger | Passed                                     | Passed                               |

The bootstrap probe used actual Stack `defineJob`, `defineQueue`, `validateInput`, `jobView`, `loadServerEnv({ server: fixtureDirectory, client: false })`, generated-style Varlock ENV access, and evlog. Its handler read an ENV value at module import, received a Date produced by its schema, updated raw ISO input, then still saw a Date. This verifies initialization ordering, not a production DB driver or Redis persistence.

**Bun-specific trap demonstrated:** importing `processor.ts?fixture=module-url` succeeded, but `new URL(import.meta.url).search` inside the processor was empty. Do not encode queue selection/bootstrap configuration in the processor URL query and expect Bun to expose it.

Use a reserved per-child environment descriptor through **both** `workerForkOptions.env` and `workerThreadsOptions.env`, merging the intended environment explicitly. Carry only module/export/queue and environment-selection metadata, never executable closures. The descriptor probe passed in both modes. An application-supplied `env` override must not silently erase Stack's descriptor. Resolve paths before spawning, preserve the chosen working directory, and package the referenced definition and its imports in production; an arbitrary runtime URL is not automatically a bundler asset.

Reproduction files remain at [probe.ts](/tmp/stack-jobs-worker-research-k7bI1u/probe.ts), [bootstrap-probe.ts](/tmp/stack-jobs-worker-research-k7bI1u/bootstrap-probe.ts), and [json-probe.ts](/tmp/stack-jobs-worker-research-k7bI1u/json-probe.ts); run each with `bun --no-env-file <path>`. These are disposable investigation artifacts, not new repository tests.

## Bootstrap, data, methods, and cancellation

Initialize environment **before dynamically importing definitions/dependencies**. Static imports that read generated `ENV` execute too early. Parent `process.env` inheritance does not initialize the child's Varlock module state. Stack's [environment loader](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/src/env/server.ts:190) can reuse the injected validated graph; use the selected schema/profile and `client: false` for a worker-only bootstrap. Application logging setup and DB modules then initialize within that isolate. Do not resolve unrelated browser configuration or run migrations per sandbox child.

The reusable processor should do only:

1. Load the selected definition once per child; import application dependencies after environment setup.
2. Resolve the actual named job or throw `UnrecoverableError`.
3. Validate **raw stored JSON** and pass its transformed output through the common handler view.
4. Forward `(job, token, signal)`; normalize the handler result to JSON before it crosses IPC.

Keep the native parent Job's `.data` raw: [asJSONSandbox](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/job.js:288) serializes it for the child. Do not replace it with a schema-transformed Date/class object before dispatch. On `updateData(input)`, JSON-round-trip the input, validate the wire value, send that unchanged value to native `updateData`, and refresh only Stack's local parsed view. Input transforms must remain pure because they run at multiple boundaries.

There is **no native `getData()`**, either on Job or on the sandbox object. Native data is a local field. Preserve Stack's parsed `.data`; if a new `getData()` helper is introduced, define whether it returns that local parsed snapshot or performs retrieval. It must not imply cross-process freshness without an actual datastore read.

The actual sandbox supplies `updateData`, `updateProgress`, `log`, `moveToDelayed`, `moveToWait`, `moveToWaitingChildren`, `getChildrenValues`, `getIgnoredChildrenFailures`, `getDependenciesCount`, and `getDependencies`. It supplies neither `getState`, `remove`, `retry`, `extendLock`, nor a datastore connection. The declaration [SandboxedJob](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/interfaces/sandboxed-job.d.ts:7) omits `getDependencies` even though the implementation supplies it. It exposes parsed `returnValue` with capital V; inherited lowercase `returnvalue` remains serialized. Do not cast it to the entire native Job API.

**Type recommendation:** distinguish the portable processing context from the full producer/retrieval Job handle. Keep schema-derived data/updateData, phases, result inference and token/signal, while advertising only methods implemented in both execution modes. A queue-level isolation flag cannot retroactively make an already-defined handler's full Job type safe.

Native progress starts at numeric `0`; normalize reads to `{ phase: "processing", percent: 0 }` and validate/normalize writes before bridging. Sandbox `updateData`/progress/log/move methods generally await **IPC send**, not acknowledgement of the parent's Redis operation. The native bridge has no request/response acknowledgement for these writes; selected dependency getters and `moveToWaitingChildren` do have responses. Do not promise that `await updateData()` in a sandbox proves durable persistence. Parent bridge errors can reject processing after a child's local view already changed. See [child wrapping](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/child-processor.js:130) and [bridge cases](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/sandbox.js:29).

[Cancellation](https://docs.bullmq.io/guide/workers/cancelling-jobs) is cooperative. The inline wrapper must have three declared parameters: BullMQ checks `.length >= 3`; the native sandbox wrapper already opts in and forwards cancellation into the child's controller. Forward the native lock token unchanged for explicit moves; it is not a cancellation token. Cancelling never preempts a synchronous CPU loop or rolls back effects. Native control-flow errors such as `DelayedError` require preserving the transition and token; distinguish these exits from ordinary handler failures in logging/shutdown accounting. Keep Stack's grace deadline around native child cleanup: [ChildPool.clean](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/child-pool.js:99) has its own 30-second kill grace.

## Completion waiting: atomic result plus explicit cursor

Use `queue.getBackend().isFinished(id, true)` for the fallback, not `getJob()` followed by `getState()`. The pinned [Lua operation](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/commands/isFinished-3.lua:18) atomically returns `[1, rawResult]` for completed, `[2, failedReason]` for failed, `[0]` for unfinished, or `[-1, missingReason]` for missing. Parse only completed raw results with JSON.parse and preserve valid falsy results. Missing is not proof of failure: immediate removal may have deleted a successful job. This is also the primitive used by [native waitUntilFinished](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/job.js:736).

`QueueEvents.waitUntilReady()` establishes connection readiness. Its [run/consume loop](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/classes/queue-events.js:47) then awaits `setName` and starts reading at `lastEventId || "$"`. A job can finish and be removed before the first `$` read.

Practical sequence:

1. Before allowing submission, establish a concrete stream cursor; construct QueueEvents with `autorun: false, lastEventId: cursor`.
2. Install outcome listeners and start the consumer; attach listeners before submission and buffer outcomes that precede the enqueue acknowledgement.
3. Once the accepted job ID is known, prefer its buffered event, then perform the atomic finished-status fallback; continue waiting if unfinished/missing.
4. Bound all stages by the same absolute `run` deadline and clean listeners/timers on every outcome and shutdown.

For the current Redis backend, capture the stream tail with `XREVRANGE ... COUNT 1`, using `"0-0"` only if empty. The adapter implementation supports that command, but the generic IRedisClient interface does not declare it. **An alternative requiring no raw-client cast:** `queue.getBackend().publishEvent({ event: "stack-ready" }, maxEvents)` returns an actual new stream ID. Use that as the cursor, preserving the application's stream retention policy. Its public native [backend contract](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/bullmq/dist/esm/interfaces/queue-backend.d.ts:503) returns the ID; QueueEventsProducer's convenience method discards it. A random marker observed by the consumer can additionally prove loop readiness if needed.

Starting at a fixed historical `"0-0"` for every new consumer replays retained events and can confuse reused job IDs. A captured cursor removes the startup gap without requiring the first blocking read to have begun before enqueueing. It still depends on stream retention: [events](https://docs.bullmq.io/guide/events/) can be trimmed before observation. Retain job records and optionally reconcile with periodic bounded `isFinished` calls when stronger recovery is needed; immediate removal plus lost/trimmed events cannot guarantee result recovery. Reused IDs/deduplication also mean `run` may await existing work rather than the latest submitted input.

## JSON types and runtime normalization

**Eden has no reusable general-purpose JSON serialization type in this pin.** Its [Treaty declarations](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/@elysiajs/eden/dist/treaty2.d.ts:18) replace generator/stream response types and serialize query Dates to `string | Date`; response status maps otherwise retain inferred response types. Its runtime revives date-looking strings by default; [parseDate](https://elysiajs.com/eden/treaty/config) can disable that. BullMQ uses JSON.parse without this revival. Do not copy Eden's response types/date behavior as the Jobs transport contract.

Keep `HandlerResultOf<D>` separate from `ResultOf<D> = Jsonify<Awaited<ReturnType<D["handler"]>>>`. Apply the transported result type to `run` and retrieved `returnvalue`; the handler itself remains free to return the inferred source shape.

A robust, deliberately bounded Jsonify contract needs contextual handling:

| Source value/type                         | Successful JSON transport shape                                     |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Valid Date / invalid Date                 | ISO string / null; conservatively `string                           | null` |
| Declared `toJSON()`                       | Recursively map its return **before** ordinary object fields        |
| undefined/function/symbol object property | Omitted; mixed serializable unions make the property optional       |
| Same values in arrays/tuples              | null; preserve tuple/rest positions and JSON's mutable arrays       |
| number, including NaN/Infinity            | number or null; finite numeric literals can remain literals         |
| Optional properties / unions              | Preserve optionality; distribute unions without collapsing to never |
| Symbol keys / readonly properties         | Drop symbol keys; decoded JSON has mutable properties               |
| BigInt / cycles                           | Runtime failure; do not pretend these are silently omitted          |
| any / unknown                             | Conservative JsonValue, with runtime rejection still possible       |

Root `void/undefined` should be an explicit Stack policy: recommend **normalize to null** in every execution mode. Reject other non-JSON roots instead of accidentally returning undefined. JSON-round-trip results **inside** the sandbox before its return message as well as inline: this prevents structured-clone restrictions or fork IPC from changing custom-toJSON/class behavior. BigInt/cycles must fail predictably before reporting a returned result, although prior business effects may already have happened.

The [ECMAScript serialization algorithms](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) define these contextual differences. Local Bun probes confirmed omission vs array null, NaN/Infinity null, valid/invalid Dates, custom toJSON, Map/Set becoming empty objects without enumerable own fields, and BigInt rejection. [Type-fest's Jsonify source](https://github.com/sindresorhus/type-fest/blob/main/source/jsonify.d.ts) is useful design evidence for contextual omission, tuple handling and toJSON; it is not an installed Stack dependency or automatically the correct root-void policy.

No conditional type can prove enumerability, absence of cycles, getter behavior, or truthful custom-toJSON declarations. Prefer ordinary DTOs/toJSON over promising exact mapping of arbitrary classes/Map/Set. Keep runtime normalization authoritative, and verify type behavior for Date, void, optional unions, nested arrays/tuples, toJSON returning undefined, and unsupported roots. A Date-only recursive mapped type leaves material holes.

## Logging and database work

Use evlog `createLogger({ queue, jobId, jobName, attempt, workerId })` once per **attempt**, accumulate fields with `set`, record errors with `error`, and emit once in `finally`. Expose it as `job.logger` or a dedicated context member: `job.log(string)` already means BullMQ's Redis-backed job log. Avoid payload/result logging by default. Distinguish handler-returned/control-transition/aborted from completion actually persisted by the parent Worker.

Stack already reexports native evlog through [logger.ts](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/src/logger.ts:1). The [standalone guidance](https://www.evlog.dev/integrate/frameworks/standalone) fits background jobs. Installed [createLogger](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/evlog/dist/audit-D3F0XCdQ.mjs:1190) uses global drain/redaction/sampling, emits synchronously, then seals the logger. **`await logger.emit()` does not flush asynchronous drains.** Applications initialize logging once per process/isolate and own drain flush at shutdown. Library processing helpers should not call `initLogger` on every job: its [configuration is overwritten globally](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/evlog/dist/logger-CjXhrRj9.d.mts:15). A parent Elysia logger configuration is not inherited module state in a child.

Database dependencies belong in ordinary application service modules imported by handlers after environment initialization. A sandbox needs its own driver/client/pool; never serialize/inject an existing connection or transaction through job data. Budget connections by active child isolates, and stop jobs before closing DB/drains. Define pure schemas; do DB lookup/authorization/version checks in the handler. Stack's [Database Block contract](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/docs/consumer/database.md) preserves native Drizzle queries and application client ownership; the pinned [Bun SQLite transaction implementation](/home/martini/.t3/worktrees/stack/t3-f439743b-d5d94843a395c932/node_modules/drizzle-orm/bun-sql/sqlite/session.js:38) uses `client.begin` and a transaction-scoped session.

Recommended application recipe, based on [Drizzle transactions](https://orm.drizzle.team/docs/transactions) and the [transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html):

1. In one DB transaction, write the business mutation and an outbox row containing a stable operation ID, versioned job kind, and JSON payload.
2. A dispatcher claims committed rows using a dialect-appropriate lock/lease, enqueues with a stable queue-wide jobId, then marks them published only after enqueue acknowledgement.
3. A crash between enqueue and published marking causes resubmission. Retained BullMQ IDs reduce duplicates; a handler must additionally enforce business idempotency with a durable unique operation key.
4. In the handler, transact the DB effect and its processed-operation record together. External effects need downstream idempotency keys or their own durable dispatch step.

A Drizzle transaction does not enlist Redis: enqueue inside the transaction can run before commit; enqueue after commit alone leaves a crash gap. `await jobs.run()` inside a transaction can hold locks while a worker waits on the same data and cannot make the two systems atomic. Include record IDs and expected versions in validated payloads, reload committed state in the handler, and keep transactions short. This is an application recipe, not a new mandatory Jobs Block database dependency.

## Validation boundary

No application code, manifests, dependencies, or existing research files were changed for this investigation. Full tests were intentionally not run. Actual checks were the isolated native sandbox/TypeScript/env/transform/logging/cancellation probes and Bun JSON behavior above. Redis completion/cursor recommendations are pinned-source analysis, not new Redis fault-injection results; production packaging, all DB drivers, and every Bun worker option remain outside those probes.
