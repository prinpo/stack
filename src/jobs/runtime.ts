import "./bun-redis";
import { type Job, Queue, QueueEvents, UnrecoverableError, Worker } from "bullmq";

import type { CreateJobsOptions, JobsClient, QueueDefinitions, RunOptions } from "./types";

import { type CancelWait, awaitCompletion } from "./completion";
import { beforeDeadline, duration } from "./deadline";
import { configuredJobsShutdownTimeout } from "./lifecycle";
import { type Dispatcher, registerRuntime, unregisterRuntime } from "./registry";
import { JobValidationError, jobView, serializeInput, validateInput } from "./validation";

export function createJobs<const Q extends QueueDefinitions>(options: CreateJobsOptions<Q>) {
  const names = new Set<string>();
  for (const [alias, definition] of Object.entries(options.queues)) {
    if (alias === "then")
      throw new TypeError("Queue alias 'then' is reserved for promise interoperability");
    if (names.has(definition.name)) throw new Error(`Duplicate queue name '${definition.name}'`);
    names.add(definition.name);
  }
  const startupTimeout = duration(options.startupTimeoutMs ?? 10_000, "startupTimeoutMs");
  const enqueueTimeout = duration(options.enqueueTimeoutMs ?? 5000, "enqueueTimeoutMs");
  const shutdownTimeoutMs = duration(
    options.shutdownTimeoutMs ?? configuredJobsShutdownTimeout(),
    "shutdownTimeoutMs",
    true,
  );
  const queues = new Map<string, Queue<unknown, unknown>>();
  const workers: Worker<unknown, unknown>[] = [];
  const events = new Map<string, QueueEvents<unknown>>();
  const pendingWaits = new Set<CancelWait>();
  const client: Record<string, unknown> = Object.create(null);
  let state: "idle" | "starting" | "ready" | "closing" | "closed" = "idle";
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const active = new Set<Job<unknown, unknown>>();
  let drained: (() => void) | undefined;
  const finished = (job: Job<unknown, unknown> | undefined) => {
    if (job) active.delete(job);
    if (!active.size) drained?.();
  };
  const report = (error: Error) => {
    if (state !== "closing" && state !== "closed") (options.onError ?? console.error)(error);
  };
  const readyQueue = (alias: string) => {
    const queue = queues.get(alias);
    if (state !== "ready" || !queue) throw new Error("Jobs runtime is not started");
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
      const submit = async (
        input: unknown,
        jobOptions?: import("bullmq").JobsOptions,
        deadline = Date.now() + enqueueTimeout,
      ) => {
        const queue = readyQueue(alias);
        const contract = definition.jobs[name];
        const wire = serializeInput(input);
        const parsed = await beforeDeadline(
          validateInput(contract, wire, name),
          deadline,
          "validation",
        );
        readyQueue(alias);
        const job = await beforeDeadline(
          queue.add(name, wire, { ...contract.defaults, ...jobOptions }),
          deadline,
          "enqueue",
        );
        if (job.opts.jobId || job.opts.deduplication) {
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
      add[name] = (input: unknown, jobOptions?: import("bullmq").JobsOptions) =>
        submit(input, jobOptions);
      run[name] = async (input: unknown, wait: RunOptions) => {
        duration(wait?.timeoutMs, "timeoutMs");
        readyQueue(alias);
        const deadline = Date.now() + wait.timeoutMs;
        let stream = events.get(alias);
        if (!stream) {
          stream = new QueueEvents(definition.name, {
            connection: options.connection,
            prefix: options.prefix,
          });
          stream.on("error", report);
          stream.setMaxListeners(0);
          events.set(alias, stream);
        }
        await beforeDeadline(
          stream.waitUntilReady(),
          Math.min(deadline, Date.now() + enqueueTimeout),
          "events readiness",
        );
        return awaitCompletion(
          readyQueue(alias),
          stream,
          () => submit(input, wait.job, Math.min(deadline, Date.now() + enqueueTimeout)),
          deadline,
          pendingWaits,
        );
      };
    }
    client[alias] = { add, run, getJob };
  }

  const close = () => {
    if (closing) return closing;
    const wasReady = state === "ready";
    state = "closing";
    unregisterRuntime(options.name ?? "default", dispatch);
    closing = (async () => {
      let force = !wasReady || shutdownTimeoutMs === 0;
      await Promise.all(workers.map((worker) => worker.pause(true)));
      if (!force) {
        try {
          await beforeDeadline(
            new Promise<void>((resolve) => {
              drained = resolve;
              if (!active.size) resolve();
            }),
            Date.now() + shutdownTimeoutMs,
            "shutdown",
          );
        } catch {
          force = true;
        } finally {
          drained = undefined;
        }
      }
      if (force)
        for (const worker of workers) worker.cancelAllJobs("Jobs runtime is shutting down");
      for (const cancel of pendingWaits) cancel(new Error("Jobs runtime is closed"));
      try {
        // Active attempts have either persisted their outcome or exhausted the grace period.
        const results = await Promise.allSettled([
          ...workers.map((worker) => worker.close(true)),
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
        active.clear();
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
      registerRuntime(options.name ?? "default", dispatch);
      for (const [alias, definition] of Object.entries(options.queues)) {
        const queue = new Queue<unknown, unknown>(definition.name, {
          ...definition.options,
          defaultJobOptions: {
            ...definition.options?.defaultJobOptions,
            ...definition.defaultJobOptions,
          },
          connection: options.connection,
          prefix: options.prefix,
        });
        queue.on("error", report);
        queues.set(alias, queue);
        const worker = new Worker<unknown, unknown>(
          definition.name,
          async (job, token, signal) => {
            active.add(job);
            const contract = Object.hasOwn(definition.jobs, job.name)
              ? definition.jobs[job.name]
              : undefined;
            if (!contract) throw new UnrecoverableError(`Unknown job '${job.name}'`);
            let parsed: unknown;
            try {
              parsed = await validateInput(contract, job.data, job.name);
            } catch (error) {
              if (error instanceof JobValidationError) throw new UnrecoverableError(error.message);
              throw error;
            }
            const handler = contract.handler as (
              job: unknown,
              token?: string,
              signal?: AbortSignal,
            ) => unknown;
            return handler(jobView(job, contract, parsed), token, signal);
          },
          {
            ...definition.worker,
            connection: options.connection,
            prefix: options.prefix,
            autorun: false,
          },
        );
        worker.on("error", report);
        worker.on("completed", finished);
        worker.on("failed", finished);
        workers.push(worker);
      }
      await beforeDeadline(
        Promise.all([...queues.values(), ...workers].map((resource) => resource.waitUntilReady())),
        Date.now() + startupTimeout,
        "startup",
      );
      if (state !== "starting") throw new Error("Jobs startup was interrupted");
      state = "ready";
      for (const worker of workers) void worker.run().catch(report);
    })().catch(async (error) => {
      await close();
      throw error;
    });
    return starting;
  };
  return { client: client as JobsClient<Q>, start, close, shutdownTimeoutMs };
}
