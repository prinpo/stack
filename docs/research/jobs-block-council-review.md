# Jobs Block council review

Reviewed 2026-11-16 against the working tree at `1adaadf`, Stack's consumer documentation and ADR 0022, installed BullMQ 6.7.6, and BullMQ's official guides cited inline. This is an assessment, not an implementation change.

The companion [BullMQ source research](bullmq-jobs-assessment.md) records exact version evidence, native contracts, OSS/Pro distinctions, and pinned source locations.

The architectural direction is sound. Keep the definition-derived producer interface, Standard Schema input validation, native BullMQ options, explicit queue composition, and managed lifecycle. Prioritize completion correctness, transport types, deployment roles, and operational visibility before adding workflow features.

## Evidence and immediate findings

The existing jobs suites pass: 3 files, 20 tests. The full suite also passes: 63 files, 760 tests. `bun --bun vp check` and `bun run example:check` pass. These checks establish the existing baseline; additional controlled-delay probes exposed cases the tests do not cover.

### 1. Completion fallback can return a stale result

**Confirmed correctness bug.** [completion.ts](../../src/jobs/completion.ts) retrieves a `Job` snapshot, subsequently calls `stored.getState()`, and returns `stored.returnvalue` if that later call reports completion. A job can finish between those operations. The snapshot still has `returnvalue: null`, so `run()` can resolve with null despite a non-null handler result.

A probe delayed the QueueEvents connection's `CLIENT SETNAME` by 200 ms, delayed `Job.getState()` by 100 ms, and let the handler complete after 30 ms. `run()` returned null instead of `{ echo: "x" }`. These delays simulate the independent timing of the queue and events connections; they do not change the handler's return value.

Use an atomic terminal-state/result read, such as the pinned backend's native finished-status operation after verifying its contract. Alternatively, re-read terminal data carefully while accounting for removal. Merely checking state again does not make an older result snapshot current. Add a regression test that controls operation ordering.

### 2. QueueEvents connection readiness is insufficient for the first wait

**Confirmed correctness bug.** [runtime.ts](../../src/jobs/runtime.ts) awaits `QueueEvents.waitUntilReady()` before enqueueing, but BullMQ 6.7.6's `QueueEvents.run()` separately awaits backend naming before beginning its event read. `consumeEvents()` initially uses the `$` cursor. Connection readiness therefore does not establish that the consumer is already positioned to observe subsequent completions.

A probe delayed only the events connection's `CLIENT SETNAME` by 150 ms. A fast handler executed successfully with `removeOnComplete: true`; `run()` rejected with a completion timeout. The event preceded the consumer's first read, and the fallback could not recover a job that had been removed.

Establish the stream cursor before submission and read forward from that cursor, or implement an equivalent consumer-readiness protocol. Redis connection readiness alone cannot provide the guarantee. Test immediate completion/removal, immediate failure/removal, delayed event startup, reconnect, and stream trimming. BullMQ's event stream has bounded retention; it is not permanent result storage. See [BullMQ events](https://docs.bullmq.io/guide/events/).

### 3. Native control-flow exits leave stale active attempts

**Confirmed lifecycle bug.** Stack adds handler jobs to an `active` set and removes them only on worker `completed` or `failed`. BullMQ intentionally emits neither event for control-flow exits such as `DelayedError`, `WaitingError`, and `WaitingChildrenError`; its manual rate-limit path also returns without emitting `failed`.

A handler moved its job to delayed and threw `DelayedError`. Retrieval confirmed the delayed state. After the handler had exited, closing a runtime configured with a 250 ms grace period took approximately 252 ms. The stale entry exhausted the grace period. Repeated transitions also retain obsolete Job objects until close.

Rework active-attempt accounting to cover native control-flow transitions and lost-lock paths. Preserve the existing intention to wait until an ordinary completion/failure has persisted: deleting an attempt in a handler `finally` block would end accounting too early. Test native transitions alongside successful draining and Redis loss during outcome persistence. See [BullMQ process-step jobs](https://docs.bullmq.io/patterns/process-step-jobs).

### 4. Result inference describes the handler rather than transport

**Confirmed, documented limitation.** [types.ts](../../src/jobs/types.ts) infers `ResultOf` directly from the handler. BullMQ serializes results to JSON. A probe returned `{ date: new Date(...) }`; the client received a string for `date`, while TypeScript advertises Date.

ADR 0022 explicitly defers this mapping, so this is an accepted design limitation rather than an undocumented implementation deviation. Nevertheless, it weakens the Block's central type-safety promise. Resolve it before stabilizing the interface.

Prefer a deliberately specified JSON-native result contract initially, with runtime handling for unsupported values and clear semantics for void. Another option is a carefully tested transport type mapping. A simple mapped type is insufficient for custom `toJSON`, optional properties, nested undefined, nonfinite numbers, classes, and unsupported values. Add optional result schemas when validating independently deployed producer/worker contracts becomes necessary. Rich-value codecs can remain deferred.

### 5. Advertised worker settings include ineffective sandbox options

**Confirmed by pinned source inspection.** `QueueDefinition.worker` accepts native WorkerOptions except connection, prefix, and autorun, so it accepts `useWorkerThreads` and sandbox process/thread options. Stack always supplies a function processor. In BullMQ's Worker constructor, a function processor is installed directly; child pools and `useWorkerThreads` are used only for a processor file/URL. Consequently, setting `worker: { useWorkerThreads: true }` does not isolate a Stack handler.

Omit or reject settings that cannot take effect until Stack supports sandboxed processors, and document this limitation near concurrency. Source inspection is sufficient to establish the branch behavior; this finding was not exercised in a separate process/thread probe. See [BullMQ sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors).

## Architecture and developer experience

**Keep the single definition.** Schema, handler, defaults, and phases live together, and producer types derive from them. This removes duplicated producer/worker contracts. Explicit registries are easy to inspect, and definitions do not open connections. This matches [ADR 0002](../adr/0002-compose-independent-blocks-with-native-apis.md) and [ADR 0022](../adr/0022-derive-job-clients-from-bullmq-job-definitions.md).

**Keep both validation points.** Submission serializes input, validates the actual wire value, and stores it unchanged. Execution transforms that wire value for the handler. This avoids applying transformations to an already transformed value. Retrieval validates again, and `updateData` accepts schema input while exposing parsed output. The cost is repeated validation, which is documented. Validators should remain pure; database lookups and external calls belong in handler logic. Worker validation currently has no deadline, unlike producer validation.

**Keep the current enqueue syntax.** `jobs.utilities.add.formatMessage(input)` and `run.formatMessage(input, { timeoutMs, job })` are discoverable and infer well. The operation-first arrangement also preserves the ADR. There is insufficient benefit in reversing it and requiring a migration.

**The typed client is a process-local locator.** Its lightweight import is useful, but it neither owns a Redis connection nor submits from another process without a runtime there. `createJobsClient<Queues>()` can look more autonomous than it is. Strengthen that explanation in examples; prefer explicit `runtime.client` injection in modules/tests that already have the runtime. Retain the locator as a convenience.

**Separate production roles.** `createJobs().start()` always constructs a Worker for every queue. A web-only producer, independent worker fleet, and batch-producing CLI cannot use the managed runtime without also consuming jobs. Add producer-only and worker-only startup roles, worker queue selection, and a documented worker entry point. Keep the shared definitions; first support role separation without forcing a separate contract system.

This extends the initial in-process choice in ADR 0022. It should be recorded as a deliberate architectural evolution. Worker isolation is more urgent than typed flows because deployment, scaling, source reloads, and CPU workloads all depend on it.

**Clarify option ownership.** Queue defaults currently have two native paths: `options.defaultJobOptions` and top-level `defaultJobOptions`, followed by job `defaults` and enqueue overrides. Choose one documented preferred path and consider omitting the duplicate from the wrapper type. The timeout named `enqueueTimeoutMs` also bounds retrieval and event readiness; `operationTimeoutMs` would describe its current scope more accurately.

**Retain native methods with explicit guarantees.** The job view preserves a broad native Job surface while validating selected data/progress operations. That is useful under ADR 0002, but the facade does not impose its operation deadline, lifetime guards, or schema validation on every inherited method. Document precisely which operations Stack strengthens. For advanced integration, expose or document access to the existing native Queue/Worker/QueueEvents rather than making applications duplicate connection, prefix, lifecycle, and error wiring.

**Consolidate completion dispatch before scaling `run`.** Every outstanding run installs two queue-wide event listeners, and its pre-ID buffer collects outcomes for every completed/failed job on that queue until submission resolves. Under concurrent waits this multiplies event dispatch and buffering work. Cleanup in `finally` is good; disabling listener warnings does not address the cost. Prefer a shared completion dispatcher with per-ID waiters and a bounded strategy for outcomes that precede enqueue acknowledgement. Measure this before choosing limits; the review did not benchmark throughput.

**Make Bun adapter support precise.** The package pins and uses BullMQ's Bun adapter. [bun-redis.ts](../../src/jobs/bun-redis.ts) installs a process-global default factory on import, while preserving an existing factory. This is documented and connection-free, but import order remains part of integration behavior. The factory forwards a selected set of native options; the broad BullMQ connection type should not imply every driver option is supported by Bun. Prefer rejecting unsupported topology/driver settings clearly, and publish a tested compatibility matrix. See [BullMQ connections](https://docs.bullmq.io/guide/connections).

## Reliability and operating model

**Deployment compatibility needs a practical recipe.** All workers on a queue can receive every job kind. Stack makes unknown names unrecoverable. During a rolling deployment, a new producer may submit a new name that an old worker permanently fails. Even renaming a registry property changes the wire-level job name. Incompatible schema changes also invalidate persisted jobs.

Document consumer-first rollouts with producer feature gating, or versioned queues for incompatible contracts. For the current combined web/worker runtime, versioned queues are often the easier robust option. Show how old queues drain and how queued data survives an upgrade. Avoid silently treating unknown jobs as supported; any alternative policy needs explicit retry/quarantine semantics.

**Use idempotency at the side-effect boundary.** Crash recovery, lost locks, and ambiguous enqueue timeouts can cause repeated work. Custom IDs and deduplication reduce duplicate submission; neither makes a payment, email, or database update exactly once. A retained custom job ID prevents re-adding that ID only while its record exists. Retention therefore affects the deduplication window. Show a business operation ID, a durable uniqueness constraint or provider idempotency key, and retries. See [idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [job IDs](https://docs.bullmq.io/guide/jobs/job-ids), and [auto-removal](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs).

**Explain which input a deduplicated `run` observes.** Stack correctly re-reads stored kind/input on ID reuse, but that does not imply the existing result corresponds to the new input. A completed custom ID can return an earlier result. With native `keepLastIfActive`, the new payload can be reserved for a subsequent job while enqueueing returns the currently active job's ID; waiting on that ID observes the active job. Document this explicitly and consider whether some deduplication modes should be rejected by `run` unless callers opt into sharing an existing result. See [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication).

**Document the database/enqueue transaction gap.** A database commit followed by Redis enqueue can lose a notification if the process crashes between them. Reversing the order can create a job for uncommitted data. Provide a transactional-outbox recipe using the existing Database Block, an idempotent relay, and idempotent consumers. A general outbox implementation need not be the first feature, but the limitation should be explicit.

**Separate three deadlines.** Submission timeout bounds the caller's acceptance wait; `run.timeoutMs` bounds the caller's whole wait; execution timeout bounds an attempt. The first two do not cancel execution. Add `AbortSignal` for abandoning a completion wait, a cooperative execution deadline policy, and a deliberate cancellation contract for waiting and active jobs. BullMQ already supplies a handler signal and local Worker cancellation methods. Cross-worker cancellation needs its own mechanism. See [cancelling jobs](https://docs.bullmq.io/guide/workers/cancelling-jobs).

**Observe ordinary failures.** Stack's `onError(error)` reports infrastructure errors, while a failed job added without `run()` remains on Redis without a structured application callback. Offer typed hooks for attempt failure, terminal failure, stalled jobs, completion, and connection state. Include runtime, queue alias/native name, job name/ID, attempt, and duration. Integrate with the existing logger while avoiding payload logging by default. Propagate request correlation and trace context explicitly.

**Measure worker health separately from startup readiness.** Initial Redis readiness does not establish continuing processing health. Expose enough information for applications to report backlog, oldest waiting age, active jobs, failures, stalls, processing latency, and connection/worker status. An HTTP liveness endpoint should not create restart loops merely because Redis is unavailable; readiness and degradation are separate application policies.

**Queue design is an operating decision.** Jobs in one queue share the worker's concurrency, limiter, pause, backlog, and ordering constraints. The example's `concurrency: 4` is per Worker, not a fleet-wide cap. Separate queues for independently scaled workloads and external-service limits. BullMQ provides global concurrency and rate controls; document their distinction from local concurrency and provide access to them. CPU-heavy work requires actual isolation; increasing inline concurrency does not create CPU parallelism. See [global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency), [rate limiting](https://docs.bullmq.io/guide/rate-limiting), and [sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors).

**The local infrastructure already gets important things right.** The example Redis has AOF, noeviction, a healthcheck, a persistent volume, and a loopback-only port. QueueDash is already present, so a dashboard is not a missing feature. Pin its image rather than using `latest`, document its port and supported BullMQ version, and align its fixed development prefix with the application's configurable environment prefix. Dashboard edits bypass producer validation, though Stack workers still validate input. Production should document persistence/recovery, queue-specific retention, capacity, and alerting. See [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production).

## Feature order

1. Fix completion races and native control-flow drain accounting. Add regression coverage for the exact interleavings, immediate removals, lost locks, and outage/reconnect during active work.
2. Resolve transported result types. Add structured timeout/failure errors carrying queue, job, operation, and known job ID; preserve the distinction between terminal failure, wait timeout, validation failure, and ambiguous submission.
3. Support producer-only/worker-only runtimes and a separate worker lifecycle. Document compatible rolling deployment, idempotency, outbox integration, and CPU isolation.
4. Add typed lifecycle hooks, status/metrics integration, and an explicit native-resource escape hatch. Keep application retention/retry policies visible and configurable; offer production examples rather than changing native defaults silently.
5. Add typed bulk enqueueing. Validate all inputs before the native bulk operation, preserve queue/job/override defaults, and distinguish one atomic Redis bulk insertion from N individual calls. Bulk insertion atomicity does not imply atomic execution. See [BullMQ bulk enqueueing](https://docs.bullmq.io/guide/queues/adding-bulks).
6. Add typed Job Scheduler management: stable IDs, validated templates, upsert/list/remove, cron/timezone/end semantics, and documented cadence under queue saturation. BullMQ 6 no longer accepts legacy `repeat` on `Queue.add`; model its Job Scheduler interface directly. See [Job Schedulers](https://docs.bullmq.io/guide/job-schedulers/).
7. Add typed flows when real workflows require them. Preserve child-before-parent semantics and explicit failure policy. ADR 0022 already chooses default terminal child failure propagation; explain that parent finalization requires a parent worker and siblings are not automatically cancelled. Distinguish child-result unions from named result slots. See [fail-parent semantics](https://docs.bullmq.io/guide/flows/fail-parent).
8. Add application-authorized status/progress delivery over HTTP/SSE only after defining a safe DTO and ownership checks. Keep Redis credentials and native Job objects server-side. Polling through existing Elysia/Eden is a reasonable initial recipe.

Do not expand the first version into a durable-workflow engine, automatic exactly-once framework, generic transport protocol, or implicit multi-tenant scheduler. Define a tested Redis/Bun scope first. Evaluate newer BullMQ capabilities against the installed release rather than assuming old v5 tutorials or generic OSS/Pro feature lists still apply.

BullMQ's current official documentation also covers an optional PostgreSQL backend, and the installed package contains it. Stack's managed Jobs runtime does not expose the backend factory and remains Redis-specific. This is worth a separate investigation for applications already operating PostgreSQL, rather than an immediate rewrite: qualify Bun/runtime compatibility, migrations, feature parity, operational behavior, and actual transaction integration before advertising it. Reusing a database does not by itself make application writes and enqueueing atomic. See [BullMQ PostgreSQL backend](https://docs.bullmq.io/guide/postgresql).
