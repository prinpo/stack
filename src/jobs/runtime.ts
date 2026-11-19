import "./bun-redis";
import { Queue, QueueEvents } from "bullmq";
import { createLogger } from "evlog";
import { AsyncLocalStorage } from "node:async_hooks";

import type {
  CreateJobsOptions,
  JobsClient,
  JobsRuntime,
  QueueDefinitions,
  RunOptions,
} from "./types";

import { type CancelWait, awaitCompletion } from "./completion";
import { JobsTimeoutError, beforeDeadline, duration } from "./deadline";
import { configuredJobsShutdownTimeout, jobsCleanupTimeoutMs } from "./lifecycle";
import { openQueue, processDefinedJob } from "./processor";
import { type Dispatcher, registerRuntime, unregisterRuntime } from "./registry";
import { jobView, progressValue, serializeInput, validateInput } from "./validation";
import { JobsWorker } from "./worker";

export function createJobs<const Q extends QueueDefinitions>(
  options: CreateJobsOptions<Q>,
): JobsRuntime<Q> {
  return createRuntime(options, "producer");
}

/** Only the standalone worker entry starts consumers. */
export function createWorkerRuntime<const Q extends QueueDefinitions>(
  options: CreateJobsOptions<Q>,
  mode: "worker" | "check" = "worker",
): JobsRuntime<Q> {
  return createRuntime(options, mode);
}

function createRuntime<Q extends QueueDefinitions>(
  options: CreateJobsOptions<Q>,
  mode: "producer" | "worker" | "check",
): JobsRuntime<Q> {
  const names = new Set<string>();
  for (const [alias, definition] of Object.entries(options.queues)) {
    if (alias === "then")
      throw new TypeError("Queue alias 'then' is reserved for promise interoperability");
    if (names.has(definition.name)) throw new Error(`Duplicate queue name '${definition.name}'`);
    names.add(definition.name);
    const sandbox = definition.worker?.sandbox;
    if (sandbox !== undefined && (!["process", "thread"].includes(sandbox) || !definition.module))
      throw new TypeError(
        `Sandboxed queue '${alias}' requires a process or thread sandbox and module: import.meta.url`,
      );
  }
  const startupTimeout = duration(options.startupTimeoutMs ?? 10_000, "startupTimeoutMs");
  const enqueueTimeout = duration(options.operationTimeoutMs ?? 5000, "operationTimeoutMs");
  const generateJobId = options.generateJobId ?? Bun.randomUUIDv7;
  const allocationsClosed = new AbortController();
  const nextJobId = async (deadline: number, signal?: AbortSignal) => {
    allocationsClosed.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new JobsTimeoutError("ID generation");
    const generated = generateJobId();
    const id =
      typeof generated === "string"
        ? generated
        : await beforeDeadline(
            Promise.resolve(generated),
            deadline,
            "ID generation",
            signal ? AbortSignal.any([signal, allocationsClosed.signal]) : allocationsClosed.signal,
          );
    if (typeof id !== "string" || !id.trim() || id.includes(":") || /^-?\d+$/.test(id))
      throw new TypeError("generateJobId must return a nonempty, non-integer string without ':'");
    return id;
  };
  const shutdownTimeoutMs = duration(
    options.shutdownTimeoutMs ?? configuredJobsShutdownTimeout(),
    "shutdownTimeoutMs",
    true,
  );
  const queues = new Map<string, Queue<unknown, unknown>>();
  const workers: JobsWorker[] = [];
  const events = new Map<string, QueueEvents<unknown>>();
  const startupCancellation = new AbortController();
  const attempts = new AsyncLocalStorage<{ active: boolean }>();
  const resources = new AsyncDisposableStack();
  const pendingWaits = new Set<CancelWait>();
  const client: Record<string, unknown> = Object.create(null);
  let state: "idle" | "starting" | "ready" | "closing" | "closed" = "idle";
  let drainingAttempts = false;
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const report = (error: Error) => {
    if (state !== "closing" && state !== "closed") (options.onError ?? console.error)(error);
  };
  const readyQueue = (alias: string) => {
    const queue = queues.get(alias);
    if (!(state === "ready" || (drainingAttempts && attempts.getStore()?.active)) || !queue)
      throw new Error("Jobs runtime is not started");
    return queue;
  };
  const dispatch: Dispatcher = async (alias, operation, name, args) => {
    const entry = Object.hasOwn(client, alias) ? client[alias] : undefined;
    if (!entry || typeof entry !== "object") throw new Error(`Unknown queue '${alias}'`);
    const group: unknown = Reflect.get(entry, operation);
    const method: unknown =
      name === undefined
        ? group
        : group && Object.hasOwn(Object(group), name)
          ? Reflect.get(Object(group), name)
          : undefined;
    if (typeof method !== "function") throw new Error(`Unknown job '${name}' on queue '${alias}'`);
    return Reflect.apply(method, undefined, args);
  };

  for (const [alias, definition] of Object.entries(options.queues)) {
    const add: Record<string, unknown> = Object.create(null);
    const inspect: Record<string, unknown> = Object.create(null);
    const run: Record<string, unknown> = Object.create(null);
    const retrieve = async (id: string, expected?: string) => {
      const deadline = Date.now() + enqueueTimeout;
      const job = await beforeDeadline(readyQueue(alias).getJob(id), deadline, "retrieval");
      if (!job || (expected !== undefined && job.name !== expected)) return undefined;
      const contract = Object.hasOwn(definition.jobs, job.name)
        ? definition.jobs[job.name]
        : undefined;
      if (!contract) throw new Error(`Unknown job '${job.name}'`);
      const parsed = await beforeDeadline(
        validateInput(contract, job.data, job.name),
        deadline,
        "validation",
      );
      return jobView(job, contract, parsed);
    };
    const getJob = (id: string) => retrieve(id);
    for (const name of Object.keys(definition.jobs)) {
      Object.defineProperty(getJob, name, { value: (id: string) => retrieve(id, name) });
      const contract = definition.jobs[name];
      inspect[name] = async (id: string) => {
        const deadline = Date.now() + enqueueTimeout;
        // One native job hash read keeps identity, result, progress and terminal state together.
        const row = await beforeDeadline(
          readyQueue(alias).getBackend().getJobData(id),
          deadline,
          "inspection",
        );
        if (!row || row.name !== name) return { state: "missing" };
        const data = await beforeDeadline(
          validateInput(contract, JSON.parse(row.data), name),
          deadline,
          "validation",
        );
        const snapshot = { id, data, progress: progressValue(row.progress, contract.phases, true) };
        if (row.finishedOn === undefined) return { ...snapshot, state: "pending" };
        if (row.returnvalue !== undefined)
          return { ...snapshot, state: "completed", result: JSON.parse(row.returnvalue) };
        return { ...snapshot, state: "failed", reason: row.failedReason };
      };
      const submissionOptions = (jobOptions?: import("bullmq").JobsOptions) => ({
        ...definition.options?.defaultJobOptions,
        ...contract.defaults,
        ...jobOptions,
      });
      add[name] = async (input: unknown, jobOptions?: import("bullmq").JobsOptions) => {
        const queue = readyQueue(alias);
        const opts = submissionOptions(jobOptions);
        const deadline = Date.now() + enqueueTimeout;
        const wire = serializeInput(input);
        const parsed = await beforeDeadline(
          validateInput(contract, wire, name),
          deadline,
          "validation",
        );
        const id = opts.jobId ?? (await nextJobId(deadline));
        if (id === "") throw new TypeError("jobId must be a nonempty string");
        readyQueue(alias);
        if (Date.now() >= deadline) throw new JobsTimeoutError("enqueue");
        const job = await beforeDeadline(
          queue.add(name, wire, { ...opts, jobId: id }),
          deadline,
          "enqueue",
        );
        if (opts.jobId || opts.deduplication) {
          const stored = job.id
            ? await beforeDeadline(queue.getJob(job.id), deadline, "job identity")
            : undefined;
          if (stored) {
            if (stored.name !== name)
              throw new Error(`Job ID '${job.id}' belongs to another job kind '${stored.name}'`);
            const actual = await beforeDeadline(
              validateInput(contract, stored.data, name),
              deadline,
              "validation",
            );
            return jobView(stored, contract, actual);
          }
        }
        return jobView(job, contract, parsed);
      };
      run[name] = async (input: unknown, wait: RunOptions) => {
        duration(wait?.timeoutMs, "timeoutMs");
        wait.signal?.throwIfAborted();
        const jobOptions = submissionOptions(wait.job);
        if (jobOptions.jobId !== undefined || jobOptions.deduplication !== undefined)
          throw new TypeError("run requires a fresh job; use add with custom IDs or deduplication");
        const queue = readyQueue(alias);
        const deadline = Date.now() + wait.timeoutMs;
        const wire = serializeInput(input);
        await beforeDeadline(
          validateInput(contract, wire, name),
          Math.min(deadline, Date.now() + enqueueTimeout),
          "validation",
          wait.signal,
        );
        const id = await nextJobId(Math.min(deadline, Date.now() + enqueueTimeout), wait.signal);
        let stream = events.get(alias);
        if (!stream) {
          // A concrete cursor survives delayed consumer startup; '$' can skip a fast result.
          const lastEventId = await beforeDeadline(
            readyQueue(alias)
              .getBackend()
              .publishEvent(
                { event: "stack:observer" },
                definition.options?.streams?.events?.maxLen ?? 10_000,
              ),
            Math.min(deadline, Date.now() + enqueueTimeout),
            "events cursor",
            wait.signal,
          );
          readyQueue(alias);
          // Another concurrent run may have initialized the observer while we awaited Redis.
          stream = events.get(alias);
          if (!stream) {
            stream = new QueueEvents(definition.name, {
              connection: options.connection,
              prefix: options.prefix,
              lastEventId,
            });
            stream.on("error", report);
            stream.setMaxListeners(0);
            events.set(alias, stream);
          }
        }
        await beforeDeadline(
          stream.waitUntilReady(),
          Math.min(deadline, Date.now() + enqueueTimeout),
          "events readiness",
          wait.signal,
        );
        return awaitCompletion(
          queue,
          stream,
          id,
          () => {
            wait.signal?.throwIfAborted();
            if (Date.now() >= deadline) throw new JobsTimeoutError("enqueue");
            return beforeDeadline(
              readyQueue(alias).add(name, wire, { ...jobOptions, jobId: id }),
              Math.min(deadline, Date.now() + enqueueTimeout),
              "enqueue",
              wait.signal,
            );
          },
          deadline,
          pendingWaits,
          wait.signal,
        );
      };
    }
    client[alias] = { add, run, getJob, inspect };
  }

  const close = () => {
    if (closing) return closing;
    const wasReady = state === "ready";
    state = "closing";
    drainingAttempts = wasReady;
    startupCancellation.abort(new Error("Jobs startup was interrupted"));

    closing = (async () => {
      let force = !wasReady || shutdownTimeoutMs === 0;
      const deadline = Date.now() + shutdownTimeoutMs;
      const draining = Promise.all(workers.map((worker) => worker.drain()));
      try {
        if (!force) await beforeDeadline(draining, deadline, "shutdown");
      } catch {
        force = true;
      }
      void draining.catch(() => {});
      drainingAttempts = false;
      allocationsClosed.abort(new Error("Jobs runtime is closed"));
      unregisterRuntime(options.name ?? "default", dispatch);
      for (const cancel of pendingWaits) cancel(new Error("Jobs runtime is closed"));
      try {
        // Active attempts have either persisted their outcome or exhausted the grace period.
        const results = await Promise.allSettled([
          ...workers.map((worker) => worker.shutdown(force, deadline)),
          beforeDeadline(
            resources.disposeAsync(),
            deadline + jobsCleanupTimeoutMs,
            "handler cleanup",
          ),
          ...[...queues.values(), ...events.values()].map(async (resource) => {
            await resource.getBackend().close(true);
            await resource.close();
          }),
        ]);
        const failures = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Jobs cleanup failed");
      } finally {
        state = "closed";
        queues.clear();
        events.clear();
        workers.splice(0);
      }
    })();
    return closing;
  };

  const start = () => {
    if (state === "closing" || state === "closed")
      return Promise.reject(new Error("Jobs runtime is closed"));
    if (starting) return starting;
    state = "starting";
    starting = (async () => {
      const hostQueues: ((scope: AsyncDisposableStack) => Promise<void>)[] = [];
      const preparations: (() => Promise<void>)[] = [];
      registerRuntime(options.name ?? "default", dispatch);
      for (const [alias, definition] of Object.entries(options.queues)) {
        const queue = new Queue<unknown, unknown>(definition.name, {
          ...definition.options,
          connection: options.connection,
          prefix: options.prefix,
        });
        queue.on("error", report);
        queues.set(alias, queue);
        if (mode === "producer") continue;
        const { sandbox, ...workerOptions } = definition.worker ?? {};
        let handlers = definition;
        const env = {
          ...process.env,
          _STACK_JOBS_SANDBOX: JSON.stringify({
            module: definition.module,
            name: definition.name,
            jobs: Object.keys(definition.jobs).sort(),
            logging: options.logging ?? true,
          }),
        };
        const worker = new JobsWorker(
          definition.name,
          !sandbox
            ? (job, token, signal) => {
                const scope = { active: true };
                return attempts.run(scope, async () => {
                  try {
                    return await processDefinedJob(
                      handlers,
                      job,
                      token,
                      signal,
                      options.logging ?? true,
                    );
                  } finally {
                    scope.active = false;
                  }
                });
              }
            : new URL("./sandbox-entry.ts", import.meta.url),
          {
            ...workerOptions,
            ...(sandbox === "process"
              ? { workerForkOptions: { env } }
              : sandbox === "thread"
                ? { useWorkerThreads: true, workerThreadsOptions: { env } }
                : {}),
            connection: options.connection,
            prefix: options.prefix,
            autorun: false,
          },
        );
        const record = (
          event: string,
          job?: { id?: string; name: string; attemptsMade: number },
          error?: Error,
        ) => {
          if (options.logging === false) return;
          const log = createLogger({
            event,
            runtime: options.name ?? "default",
            queue: definition.name,
            queueAlias: alias,
            jobId: job?.id,
            jobName: job?.name,
            attemptsMade: job?.attemptsMade,
          });
          if (error) log.error(error);
          log.emit();
        };
        worker.on("completed", (job) => record("job.completed", job));
        worker.on("failed", (job, error) =>
          record(job?.finishedOn ? "job.failed" : "job.retrying", job, error),
        );
        worker.on("stalled", (jobId) =>
          record("job.stalled", { id: jobId, name: "unknown", attemptsMade: 0 }),
        );
        worker.on("error", report);
        workers.push(worker);
        if (sandbox)
          preparations.push(async () => {
            try {
              await worker.preflight();
            } catch (cause) {
              throw new Error(
                `Worker '${alias}' (${sandbox}) initialization failed in ${definition.module}: ${cause instanceof Error ? cause.message : String(cause)}`,
                { cause },
              );
            }
          });
        else
          hostQueues.push(async (scope) => {
            handlers = await openQueue(definition, scope);
          });
      }
      preparations.push(async () => {
        const local = new AsyncDisposableStack();
        try {
          for (const open of hostQueues) {
            startupCancellation.signal.throwIfAborted();
            await open(local);
          }
          if (state === "starting") resources.use(local.move());
        } finally {
          await local.disposeAsync();
        }
      });
      await beforeDeadline(
        Promise.all([
          ...preparations.map((prepare) => prepare()),
          ...[...queues.values(), ...workers].map((resource) => resource.waitUntilReady()),
        ]),
        Date.now() + startupTimeout,
        "startup",
        startupCancellation.signal,
      );
      if (state !== "starting") throw new Error("Jobs startup was interrupted");
      state = "ready";
      if (process.env._STACK_LOCAL_SESSION === "1" || mode === "check")
        console.log(
          `Jobs ready: ${mode === "producer" ? "producer only" : Object.keys(options.queues).join(", ")}`,
        );
      if (mode === "worker") for (const worker of workers) void worker.run().catch(report);
    })().catch(async (error) => {
      await close();
      throw error;
    });
    return starting;
  };
  return {
    name: options.name ?? "default",
    client: client as JobsClient<Q>,
    native: (alias: keyof Q & string) => ({
      queue: readyQueue(alias),
      worker: workers.find((worker) => worker.name === options.queues[alias].name),
      events: events.get(alias),
    }),
    start,
    close,
    shutdownTimeoutMs,
  };
}
