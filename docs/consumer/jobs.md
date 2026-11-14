---
title: Background jobs
description: Define schema-backed BullMQ jobs, derive a typed backend client, and run workers through Stack's lifecycle.
type: reference
topics: [jobs, bullmq, queues, workers, validation, progress, lifecycle]
related:
  title: Related
  links: [application-patterns.md, backend.md, env.md, development.md, production.md]
---

# Background jobs

The Jobs Block adds typed definitions and runtime validation to BullMQ. Workers initially run in the backend process and share the application's datastore. Backend producers connect directly through the registered runtime; no jobs HTTP server is needed. Stack uses Bun's built-in Redis client through BullMQ's adapter, without an additional Redis driver dependency. Redis is the qualified example datastore; application configuration remains native BullMQ connection configuration, including compatible Redis services such as Valkey. Applications own credentials, datastore provisioning, and job policies.

## Definitions

Define jobs beside their handlers and compose explicit queues. These helpers open no connections and start no workers.

```ts
import { defineJob, defineQueue, z } from "@prinpo/stack/jobs";

export const formatMessage = defineJob({
  input: z.object({ text: z.string().trim().min(1) }),
  phases: ["formatting"],
  handler: async (job) => {
    await job.updateProgress({ phase: "formatting", percent: 100 });
    return { text: job.data.text.toUpperCase() };
  },
});

export const queues = {
  utilities: defineQueue("utilities", {
    jobs: { formatMessage },
    worker: { concurrency: 4 },
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  }),
};
export type Queues = typeof queues;
```

Accept any Standard Schema v1 validator, including asynchronous validators and transformations. Zod is shipped and preferred; it is reexported as `z`. Elysia's native TypeBox `t` schemas in this release require a Standard Schema adapter for jobs. Input and result types derive from the schema and handler; no parallel contracts or generated clients are needed. The queue registry key names the client property, the job registry key names the job, and `defineQueue` supplies the native datastore queue name.

Queue `worker` accepts native worker settings except lifecycle-owned connection, prefix, and autorun. Queue `options` supplies other native queue settings. Job `defaults` and enqueue options override queue defaults in that order, using BullMQ's shallow option merging. Unspecified retry, backoff, deduplication, and retention settings keep native defaults. Choose bounded retention explicitly for your application.

## Shared setup and startup

The built-in client supports Redis 7.2 and newer.

Importing the Jobs Block installs Bun's Redis adapter as BullMQ's default client factory if no application factory is already configured. This opens no connections. URL or host/port settings, authentication, database selection, TLS, and connection timeouts are passed to the built-in client; BullMQ's adapter owns reconnection. Supply a native client or an application factory for driver-specific options beyond Bun's support. The lightweight `/jobs/client` entry does not configure a driver.

Declare connection settings in the application's server environment schema, for example:

```dotenv
# @sensitive @dynamic @required @type=url
JOBS_REDIS_URL=redis://127.0.0.1:6379
```

Generate accessors through `stack env codegen --server`. Register one jobs plugin in the [shared setupPlugin](application-patterns.md#shared-backend-setup), alongside logging and auth:

```ts
import { jobsPlugin } from "@prinpo/stack/jobs/elysia";
import { Elysia } from "@prinpo/stack/server";

import { ENV } from "../../env-gen/server";
import { authHelpers } from "../auth/instance";
import { queues } from "../jobs/queues";
import { logging } from "./logging";

export const setupPlugin = new Elysia({ name: "app:setup" })
  .use(logging)
  .use(authHelpers.elysia())
  .use(jobsPlugin({ queues, connection: { url: ENV.JOBS_REDIS_URL } }));
```

Keep the fluent chain inferred when composing plugins so each route's `.use(setupPlugin)` sees the typed `jobs` context. Standard `startServer` awaits registration and datastore readiness before opening HTTP. Failed startup closes partially initialized jobs resources. One reused plugin instance is deduplicated across route modules. Import the application only through the deferred startup loader so configuration resolves before runtime modules read `ENV`.

The default runtime name is `default`. For multiple independent runtimes in one process, assign different `name` values and give each client the corresponding name. Starting a second runtime with an already registered name fails. A runtime rejects duplicate native queue names; separate aliases cannot safely give one queue competing contracts. Queue aliases and job names reserve `then` for promise interoperability. Native APIs remain available through `@prinpo/stack/jobs`; direct native producers bypass Stack's enqueue validation, while Stack workers still validate what they receive.

## Typed backend client

Routes using setup can call `jobs` from their context. Backend helpers outside a request can use a lightweight client module:

```ts
import { createJobsClient } from "@prinpo/stack/jobs/client";

import type { Queues } from "./queues";

export const jobs = createJobsClient<Queues>();
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

`add` resolves when the datastore accepts the job and returns its typed handle. `run` enqueues and waits, returning the handler result. Its positive integer `timeoutMs` is required and bounds the whole operation, including validation and connection readiness. Terminal job failure rejects; retries occur inside that waiting period. A timeout ends the wait without cancelling the job. A timed-out submission may have been accepted; use native job IDs and idempotent handlers when retrying submissions.

Runtime options `startupTimeoutMs` and `enqueueTimeoutMs` default to 10,000 and 5,000 milliseconds. Producer validation, enqueueing, retrieval, and event readiness use bounded waits. Workers retain native reconnection behavior. Optional `onError(error)` receives connection/worker infrastructure errors; its default is console error output. Ordinary job failures remain on the job and reject `run` when terminal.

## Validation and serialization

Submission first JSON-serializes input, validates that wire value, and stores it unchanged. It discards the validator's transformed output. The worker validates again and gives the handler the parsed output. Thus a schema accepting an ISO string and transforming it to `Date` sees the string at both boundaries and supplies a `Date` to processing. Validation can run more than once, including retrieval; keep validators and transforms free of side effects. Inputs must produce a JSON value; undefined roots, cyclic objects, and BigInt are unsupported.

Malformed worker input and unknown job names fail unrecoverably rather than retrying. Ordinary handler failures follow configured BullMQ attempts/backoff. Producers and workers sharing a queue must deploy compatible names and schemas; queued input can outlive a deployment. Handlers must tolerate repeated execution after crashes or stalled locks.

Results use BullMQ's native JSON serialization. The initial result type is inferred from the handler without mapping it to its serialized shape. A returned Date therefore arrives as a string despite its inferred Date type. Use JSON-native result shapes for accurate end-to-end types. Rich-value serialization, result schema validation, and automatic result-type conversion are outside this version.

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

## Progress

Progress always has `{ phase, percent }`, initially `{ phase: "processing", percent: 0 }` through Stack's job view. Without a phase declaration, `updateProgress({ percent: 25 })` fills in `"processing"`. With a nonempty custom `phases` list, every update requires one declared phase. Readers include the initial `"processing"` phase alongside custom phases.

Percent must be finite and between 0 and 100 inclusive; decimals are allowed. Updates need not be monotonic, allowing phase changes and retries. Stack validates progress updates at runtime. Progress describes application work; completing a handler does not automatically set it to 100.

## Standalone runtime and shutdown

```ts
import { createJobs } from "@prinpo/stack/jobs";

const runtime = createJobs({ queues, connection });
await runtime.start();
try {
  await runtime.client.utilities.run.formatMessage({ text: "hello" }, { timeoutMs: 5000 });
} finally {
  await runtime.close();
}
```

Start and close are idempotent. A closed runtime cannot restart. Stack owns connections created from options; native caller-owned clients retain their native ownership and must be closed by the application. For native Elysia hosts outside `startServer`, explicitly `await startJobs(app)` before listening and `await stopJobs(app)` before closing other job dependencies. Elysia stop hooks initiate cleanup, but native Elysia does not await asynchronous stop hooks; explicit awaited cleanup is needed when coordinating resources yourself.

Stack owns `JOBS_SHUTDOWN_TIMEOUT_MS`, a nonnegative integer defaulting to `30000`; `0` skips draining. Application environment profiles can override it. The standalone `shutdownTimeoutMs` option overrides that setting. Shutdown rejects new submissions, stops fetching new jobs, waits for active attempts to persist their outcome, then closes resources. Outstanding `run` calls reject when the runtime closes, releasing their completion listeners and timers. On grace expiry it aborts active handler signals and force-closes owned connections; JavaScript handlers must cooperate with cancellation to stop their application work.

Standard signal shutdown, managed development termination, and server-environment restarts allow the configured grace period plus 2,500 milliseconds for connection cleanup before forced process termination. Bun's native source watcher restarts code without a Stack-owned asynchronous drain boundary; source reloads can interrupt work and leave jobs for native stalled recovery. Standalone runtimes do not terminate the caller's process, and already scheduled native retry timers can briefly keep it alive after cleanup.

## Local infrastructure and scope

Put Redis in `docker-compose.dev.yml` with a `redis-cli ping` healthcheck. Existing `stack dev` starts Compose and waits before application startup; the jobs runtime then checks its actual configured connection. Production requires a separately provisioned datastore and also gates HTTP on jobs readiness. The full-stack example demonstrates healthchecked Redis, application-owned connection settings, custom phases, `add`, `run`, and checked retrieval.

Bulk helpers, schedulers, typed flows, separate worker-process commands, browser submission/subscriptions, and rich-result transport are deferred. Native BullMQ exports remain available for advanced application-owned integration. See the [BullMQ guides](https://docs.bullmq.io/guide/) and [Standard Schema specification](https://standardschema.dev/) for upstream contracts.
