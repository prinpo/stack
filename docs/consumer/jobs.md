---
title: Background jobs
description: Define schema-backed BullMQ jobs, derive a typed backend client, and run workers through Stack's lifecycle.
type: reference
topics: [jobs, bullmq, queues, workers, validation, progress, lifecycle]
related:
  title: Related
  links: [application-patterns.md, backend.md, env.md, cli.md, development.md, production.md]
---

# Background jobs

The Jobs Block adds typed definitions and runtime validation to BullMQ. Workers always run in a dedicated process. HTTP submits jobs through the same queue definitions and datastore. During development, `stack dev` starts and supervises both processes. Backend producers connect directly through the registered runtime; no jobs HTTP server is needed. Stack uses Bun's built-in Redis client through BullMQ's adapter, without an additional Redis driver dependency. Redis is the qualified example datastore; application configuration remains native BullMQ connection configuration, including compatible Redis services such as Valkey. Applications own credentials, datastore provisioning, and job policies.

## Definitions

Define jobs beside their handlers and compose explicit queues. These helpers open no connections and start no workers.

```ts
// src/server/jobs/queues/utilities/format-message.ts
import { defineJob, z } from "@prinpo/stack/jobs";

export const formatMessage = defineJob({
  input: z.object({ text: z.string().trim().min(1) }),
  phases: ["formatting"],
  handler: async (job) => {
    await job.updateProgress({ phase: "formatting", percent: 100 });
    return { text: job.data.text.toUpperCase() };
  },
});
```

```ts
// src/server/jobs/queues/utilities/index.ts
import { defineQueue } from "@prinpo/stack/jobs";

import { ENV } from "../../../../env-gen/server";
import { formatMessage } from "./format-message";

export default defineQueue("utilities", {
  jobs: { formatMessage },
  worker: { concurrency: ENV.JOBS_CONCURRENCY },
  options: {
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  },
});
```

Accept any Standard Schema v1 validator, including asynchronous validators and transformations. Zod is shipped and preferred; it is reexported as `z`. Elysia's native TypeBox `t` schemas in this release require a Standard Schema adapter for jobs. Input and result types derive from the schema and handler; no parallel contracts or generated clients are needed. The queue registry key names the client property, the job registry key names the job, and `defineQueue` supplies the native datastore queue name.

Configure a queue with `worker: { concurrency: ENV.JOBS_CONCURRENCY }`. The example declares this positive integer in Varlock with a default of four. Each worker replica has its own concurrency limit. Queue `options` carries native queue settings, including `defaultJobOptions`. BullMQ's shallow option merge applies queue defaults first, then job `defaults`, then submission options.

## Queue registry and worker entry

Keep one directory per queue, with a job definition per file. Export all queues and their shared connection options from one module:

```ts
// src/server/jobs/index.ts
import { ENV } from "../../env-gen/server";
import utilities from "./queues/utilities";

export const queues = { utilities };
export const jobs = {
  queues,
  connection: { url: ENV.JOBS_REDIS_URL },
  prefix: `app:${ENV.APP_ENV}`,
};
```

Mount `jobsPlugin(jobs)` in the HTTP application. The plugin and standalone `createJobs(jobs)` open producer connections. Only the worker entry consumes queues:

```ts
// src/server/worker.ts
import { startJobsWorker } from "@prinpo/stack/jobs";
await startJobsWorker(() => import("./jobs"));
```

Keep the import of `./jobs` inside the loader so `startJobsWorker` can validate the server environment before queue definitions read `ENV`.

| Environment | How to run the application                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development | `stack dev` starts the worker entry in its own Bun process and watches it alongside any HTTP and frontend entries.                                                                        |
| Local build | Run `stack build`, then `stack preview`. Preview starts dependencies from `docker-compose.preview.yml` when present and runs the built app and worker locally.                            |
| Production  | Supervise `stack start` for HTTP and `stack worker` for each worker replica. A worker-only build needs just `stack worker`. Apply database migrations before starting production workers. |

`stack worker --check` opens a fresh worker runtime with the selected deployment configuration, initializes Redis and handlers, then closes its resources before fetching jobs. Use it as a deployment preflight. Monitor running consumers and queue progress separately. See [CLI commands and profiles](cli.md#lifecycle-and-profiles).

## Shared setup and startup

The built-in client supports Redis 7.2 and newer.

Importing the Jobs Block installs Bun's Redis adapter as BullMQ's default client factory if no application factory is already configured. This opens no connections. URL or host/port settings, authentication, database selection, TLS, and connection timeouts are passed to the built-in client; BullMQ's adapter owns reconnection. Supply a native client or an application factory for driver-specific options beyond Bun's support. The lightweight `/jobs/client` entry does not configure a driver.

Declare the settings used by the queue and registry in the application’s Varlock server schema. Allow `rediss` when deploying to a TLS endpoint. The fullstack example’s local Redis schema allows only `redis`.

```dotenv
# @defaultSensitive=true
# @generateTsTypes(path=../../src/env-gen/server.ts, exposeEnv=local, icons=false)
# ---

# @sensitive @dynamic @required @type=url(allowedProtocols=[redis,rediss])
JOBS_REDIS_URL=redis://127.0.0.1:6379

# @public @dynamic @required @type=number(min=1, isInt=true)
JOBS_CONCURRENCY=4
```

Generate accessors through `stack env codegen --server`. Register one jobs plugin in the [shared setupPlugin](application-patterns.md#shared-backend-setup), alongside logging and auth:

```ts
import { jobsPlugin } from "@prinpo/stack/jobs/elysia";
import { Elysia } from "@prinpo/stack/server";

import { authHelpers } from "../auth/instance";
import { jobs } from "../jobs";
import { logging } from "./logging";

export const setupPlugin = new Elysia({ name: "app:setup" })
  .use(logging)
  .use(authHelpers.elysia())
  .use(jobsPlugin(jobs));
```

Keep the fluent chain inferred when composing plugins so each route's `.use(setupPlugin)` sees the typed `jobs` context. Standard `startServer` awaits registration and datastore readiness before opening HTTP. Failed startup closes partially initialized jobs resources. One reused plugin instance is deduplicated across route modules. Import the application only through the deferred startup loader so configuration resolves before runtime modules read `ENV`.

The default runtime name is `default`. For multiple independent runtimes in one process, assign different `name` values and give each client the corresponding name. Starting a second runtime with an already registered name fails. A runtime rejects duplicate native queue names; separate aliases cannot safely give one queue competing contracts. Queue aliases and job names reserve `then` for promise interoperability. Native APIs remain available through `@prinpo/stack/jobs`; direct native producers bypass Stack's enqueue validation, while Stack workers still validate what they receive.

## Typed backend client

Routes using setup can call `jobs` from their context. Backend helpers outside a request can use a lightweight client module:

```ts
// src/server/jobs/client.ts (optional)
import { createJobsClient } from "@prinpo/stack/jobs/client";

import type { queues } from "./index";

export const jobs = createJobsClient<typeof queues>();
```

This entry imports neither BullMQ nor handlers or validators. It resolves an already registered runtime in the same process; it is not a cross-process or browser client. Calls before startup and after shutdown reject clearly. Definition modules and client construction do not initialize resources.

```ts
const job = await jobs.utilities.add.formatMessage({ text: " hello " }, { delay: 1000 });

const result = await jobs.utilities.run.formatMessage(
  { text: " hello " },
  { timeoutMs: 5000, job: { attempts: 2 } },
);
// result: { text: string }
```

`add` resolves when the datastore accepts the job and returns its typed handle. `run` enqueues and waits, returning the handler result. Its positive integer `timeoutMs` is required and bounds the whole operation, including validation and connection readiness. Terminal job failure rejects; retries occur inside that waiting period. A timeout ends the wait without cancelling the job. If Redis accepts an `add` but its acknowledgement times out, the error may omit the generated ID. For submissions that callers will retry, supply a stable `jobId` and use it to look up the job. The ID prevents duplicate enqueueing while the job is retained. Make the handler’s business writes idempotent so they also tolerate redelivery or removal of the job record.

Runtime options `startupTimeoutMs` and `operationTimeoutMs` default to 10,000 and 5,000 milliseconds. Producer validation, enqueueing, retrieval, and event readiness use bounded waits. Workers retain native reconnection behavior. Optional `onError(error)` receives connection/worker infrastructure errors; its default is console error output. Structured evlog lifecycle events report ordinary failures separately; terminal failures reject `run` with `JobFailedError` (queueName, jobId, failedReason). `JobsTimeoutError` exposes operation and, when known during completion waiting, context.queueName/jobId.

## Validation and serialization

Submission first JSON-serializes input, validates that wire value, and stores it unchanged. It discards the validator's transformed output. The worker validates again and gives the handler the parsed output. Thus a schema accepting an ISO string and transforming it to `Date` sees the string at both boundaries and supplies a `Date` to processing. Validation can run more than once, including retrieval; keep validators and transforms free of side effects. Inputs must produce a JSON value; undefined roots, cyclic objects, and BigInt are unsupported.

Malformed worker input and unknown job names fail unrecoverably rather than retrying. Ordinary handler failures follow configured BullMQ attempts/backoff. Producers and workers sharing a queue must deploy compatible names and schemas; queued input can outlive a deployment. Handlers must tolerate repeated execution after crashes or stalled locks.

Results use native JSON transport with `ResultOf`/`JsonResult` describing the transported shape. Clients read dates as strings or null for invalid dates. Nonfinite numbers become null. Object properties containing undefined, functions or symbols are omitted, and the equivalent array entries become null. Root void or undefined becomes null. Return plain data or provide a `toJSON()` method that returns plain data. Unsupported class instances, BigInt and cyclic values fail during result serialization.

## Retrieval and job methods

```ts
const job = await jobs.utilities.getJob.formatMessage(id);
if (job) {
  job.data.text; // validated schema output
  job.progress; // { phase: "processing" | "formatting"; percent: number }
  await job.updateData({ text: "replacement" });
  await job.getState();
}

const anyJob = await jobs.utilities.getJob(id);
if (anyJob?.name === "formatMessage") {
  anyJob.data.text;
}
```

Named retrieval returns `undefined` for missing jobs and other job kinds. Queue-wide retrieval returns a discriminated job union, or `undefined` when missing; an unknown stored job kind rejects. Matching input is validated and transformed before `.data` is exposed. Invalid matching data rejects with `JobValidationError`, including Standard Schema `issues` and `jobName`.

Handles retain native job methods. `updateData` accepts schema input, validates its JSON representation, updates the stored input, and refreshes the handle's parsed view. Treat handler data as a validated view; use `updateData` to persist changes. `returnvalue` may be null before completion. Result and state fields are snapshots; retrieve again for current values. Direct native methods beyond the validated data/progress helpers retain BullMQ's semantics and validation boundaries.

Native job IDs and deduplication are queue-wide. When submission reuses stored work, Stack checks its actual job kind and validates its stored input before returning a handle. A collision with another kind rejects instead of advertising that other handler's result under the requested type. Keep application IDs meaningful within their queue.

### Polling a job

Use `jobs.utilities.inspect.formatMessage(id)` for an HTTP status response. A single stored-job read yields a discriminated snapshot. A matching job has its validated `data`, `id`, and `progress`. Narrow on `state` to access the terminal fields:

| State       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `missing`   | ID is absent, removed, or belongs to another job kind                   |
| `pending`   | Queued, active, delayed, waiting on children, or awaiting retry         |
| `completed` | `result` contains the transported result, including a valid null result |
| `failed`    | `reason` contains the terminal failure message                          |

Use the ID returned by `add` to poll a job later.

```ts
const { id } = await jobs.utilities.add.formatMessage({ text: "hello" });
if (id) {
  const snapshot = await jobs.utilities.inspect.formatMessage(id);
  if (snapshot.state === "completed") console.log(snapshot.result.text);
}
```

Use `getJob` for mutation and detailed native scheduling state.

## Progress

Progress always has `{ phase, percent }`, initially `{ phase: "processing", percent: 0 }` through Stack's job view. Without a phase declaration, `updateProgress({ percent: 25 })` fills in `"processing"`. With a nonempty custom `phases` list, every update requires one declared phase. Readers include the initial `"processing"` phase alongside custom phases.

Percent must be finite and between 0 and 100 inclusive; decimals are allowed. Updates need not be monotonic, allowing phase changes and retries. Stack validates progress updates at runtime. Progress describes application work; completing a handler does not automatically set it to 100.

## Standalone runtime and shutdown

A script can open a producer directly. Start a worker for the same queue and prefix before waiting on `run`.

```ts
// src/server/submit.ts
import { loadServerEnv } from "@prinpo/stack/env/server";
import { createJobs } from "@prinpo/stack/jobs";

await loadServerEnv({ client: false });
const { jobs } = await import("./jobs");
const runtime = createJobs(jobs);
await runtime.start();
try {
  await runtime.client.utilities.run.formatMessage({ text: "hello" }, { timeoutMs: 5000 });
} finally {
  await runtime.close();
}
```

Start and close are idempotent. A closed runtime cannot restart. Stack owns connections created from options; native caller-owned clients retain their native ownership and must be closed by the application. For native Elysia hosts outside `startServer`, import `startJobs` and `stopJobs` from `@prinpo/stack/jobs/elysia`. Explicitly `await startJobs(app)` before listening and `await stopJobs(app)` before closing other job dependencies. Elysia stop hooks initiate cleanup, but native Elysia does not await asynchronous stop hooks; explicit awaited cleanup is needed when coordinating resources yourself.

Stack owns `JOBS_SHUTDOWN_TIMEOUT_MS`, a nonnegative integer defaulting to `30000`; `0` skips draining. Application environment profiles can override it. The standalone `shutdownTimeoutMs` option overrides that setting. Shutdown stops new submissions from outside the runtime and stops fetching new jobs. Admitted handlers running in the worker host can still enqueue follow-up work through their runtime during the grace period. Stack waits for active attempts to persist their outcome, then closes resources. Outstanding `run` calls reject when the runtime closes, releasing their completion listeners and timers. On grace expiry it aborts active handler signals and force-closes owned connections; JavaScript handlers must cooperate with cancellation to stop their application work.

Standard signal shutdown, managed development termination, and server-environment restarts allow the configured grace period plus 2,500 milliseconds for connection cleanup before forced process termination. In projects with a worker entry, editing server code or its shared imports drains and restarts HTTP and the worker while Compose stays available. Standalone runtimes do not terminate the caller's process, and already scheduled native retry timers can briefly keep it alive after cleanup.

## Local infrastructure and scope

Put Redis in `docker-compose.dev.yml` with a `redis-cli ping` healthcheck. Existing `stack dev` starts Compose and waits before application startup; the jobs runtime then checks its actual configured connection. Production requires a separately provisioned datastore and also gates HTTP on jobs readiness. The full-stack example demonstrates healthchecked Redis, application-owned connection settings, custom phases, `add`, `run`, and checked retrieval.

Bulk helpers, schedulers, typed flows, browser submission/subscriptions, and rich-value codecs are deferred. Native BullMQ exports remain available for advanced application-owned integration. See the [BullMQ guides](https://docs.bullmq.io/guide/) and [Standard Schema specification](https://standardschema.dev/) for upstream contracts.

## Shared job context

Use `defineJobContext` once to provide application dependencies. Import the returned job-definition helper into each job that uses this context. Stack runs setup once for the worker host, shares its value across those jobs and queues, and awaits registered cleanup on graceful shutdown. The HTTP producer skips setup. The second handler argument combines these dependencies with an attempt-specific `logger` supplied by Stack.

```ts
// src/server/jobs/context.ts
import { defineJobContext } from "@prinpo/stack/jobs";

import { openDatabase } from "../database/open";
import "../plugins/logging";

export const appJob = defineJobContext((resources) => {
  const { client, db } = openDatabase();
  resources.defer(() => client.close());
  return { db };
});
```

```ts
// src/server/jobs/queues/utilities/find-message.ts
import { eq } from "@prinpo/stack/database";
import { z } from "@prinpo/stack/jobs";

import { jobResults } from "../../../database/schema";
import { appJob } from "../../context";

export const findMessage = appJob({
  input: z.object({ operationId: z.uuid() }),
  handler: async (job, { db, logger }) => {
    const { operationId } = job.data;
    logger.set({ operationId });
    const [row] = await db.select().from(jobResults).where(eq(jobResults.operationId, operationId));
    return row?.text ?? null;
  },
});
```

A plain `defineJob` handler receives `(job, token, signal)`. A handler defined with the context helper receives `(job, context, token, signal)`. The optional BullMQ lock token is used for manual job transitions. Pass the optional abort signal to cancellable work so a forced shutdown can interrupt an active attempt. Handlers in the dedicated worker process can submit follow-up work through the registered client. `runtime.native(alias)` exposes the native queue and, on a consuming host, its worker.

## Optional CPU isolation

The dedicated worker runs handlers directly by default. For a CPU-heavy queue, add `module: import.meta.url` to its default-exported queue definition and set `worker.sandbox` to `"process"` or `"thread"`. Import that module in the shared registry. Build resolves the static import graph. Worker startup loads the exported queue in an isolate and checks its queue and job names before consumption.

Each sandbox initializes its own context and owns its database connections. The lightweight jobs client resolves a runtime in its own process or thread. The parent worker’s registered client is available to handlers running directly in that worker. A sandbox that submits follow-up jobs needs its own producer, opened and closed with its context. Size pools for the number of replicas and isolates. `job.native` is available in the worker host. Portable methods such as `moveToWait` and `updateProgress` also work in sandboxes. Sandboxed updates acknowledge IPC delivery. At grace expiry Stack can terminate an unresponsive isolate.

## Completion and cancellation

`run` assigns a fresh job ID and listens for its completion before submitting. Reconciliation uses backoff and can recover retained results when events are missed. If the job and event have both been removed, recovery requires a result in application storage.

Stack uses `Bun.randomUUIDv7()` to generate IDs for both `add` and `run`. These UUIDs include the producer's timestamp in milliseconds, so sorting them as strings gives approximate creation order across producers. To use an application ID format, set `generateJobId` once in the shared jobs options used by HTTP and workers. Read the ID from the handle returned by `add` or from `job.id` inside either handler. A successful `run` returns the handler’s transported result.

```ts
export const jobs = {
  queues,
  connection: { url: ENV.JOBS_REDIS_URL },
  generateJobId: () => `job-${Bun.randomUUIDv7()}`,
};
```

The callback may return a string or a promise of a string. Its output is the job ID verbatim. Generate a fresh value across all producers that submit to the queue, including across process restarts, and keep it distinct from manually assigned IDs. Generated IDs must be nonempty and cannot be integers or contain `:`. If generation fails or times out, Stack rejects the submission before enqueueing. A worker retry keeps the original job ID.

An explicit `add(..., { jobId })` bypasses the generator. Use this or native deduplication to coalesce submissions. `run` requires a fresh ID and rejects `jobId` or `deduplication` supplied by queue defaults, job defaults, or call options.

An optional `signal` can stop submission during validation or abandon the wait after submission. An abort or timeout while Redis is accepting the enqueue may leave work queued.

## Job logging and database results

Stack emits evlog handler and worker lifecycle events by default. Set `logging: false` on a runtime to disable automatic emission. Configure evlog once per process/isolate. `job.logger.set({ operationId })` adds business fields to the handler event; native `job.log(string)` remains the separate BullMQ job log on full native handles. Payloads and results are not automatically attached. Handler-returned events precede durable native completion; job.completed, job.retrying, job.failed and job.stalled describe the worker lifecycle. Infrastructure errors continue through onError. If your logging transport needs an explicit flush, register it with the worker context’s disposal stack.

Jobs can use ordinary application services and injected database clients. Put record/operation IDs in validated input, load committed data inside the handler, and keep transactions short. Avoid waiting on run while holding a transaction that the worker needs. Each sandbox owns a separate database connection; budget pools across replicas, concurrency and isolates.

`withStoredResult({ load, run, save })` captures the common database-result pattern: reuse an existing business result, otherwise compute and await persistence before returning to BullMQ. load returns `{ result }` or undefined; save returns the canonical persisted value, including after a competing upsert. Applications own the business key, transactions and conflict policy. The helper does not make external side effects exactly once.

The full-stack saveMessage job injects Drizzle, keys results by operationId, upserts a durable job_results row and returns the committed result. Its database row survives BullMQ retention/removal. Include business writes and a processed-operation record in one native database transaction when they must commit together. For reliable database-to-Redis dispatch, use an application transactional outbox: commit the business mutation and outbox row together, enqueue committed rows with a stable jobId, then mark publication after acknowledgement. Retried delivery still requires an application conflict/idempotency policy; Redis is not enlisted in the SQL transaction.

QueueDash stays an optional development Compose tool. Applications choose their own production dashboard or omit one.
