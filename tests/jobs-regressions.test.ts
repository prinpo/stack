import {
  DelayedError,
  Job,
  RedisConnection,
  createJobs,
  defineJob,
  defineQueue,
  z,
} from "@prinpo/stack/jobs";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vite-plus/test";

import { createWorkerRuntime } from "../src/jobs/runtime";
import { testRedis } from "./test-utils/redis";

let redis: ReturnType<typeof testRedis>;
const runtimes: { close(): Promise<void> }[] = [];
beforeAll(() => {
  redis = testRedis();
}, 60_000);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});
afterAll(() => redis?.close());

function lateEvents(delay = 150) {
  const factory = RedisConnection.clientFactory!;
  vi.spyOn(RedisConnection, "clientFactory").mockImplementation((options) => {
    const client = factory(options);
    const setName = client.clientSetName.bind(client);
    client.clientSetName = async (name) => {
      if (name.endsWith(":qe")) await new Promise((resolve) => setTimeout(resolve, delay));
      return setName(name);
    };
    return client;
  });
}

test("run observes a removed completion even when the event consumer starts after execution", async () => {
  lateEvents();
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    connection: redis.connection,
    queues: {
      work: defineQueue(crypto.randomUUID(), {
        jobs: {
          echo: defineJob({ input: z.string(), handler: async (job) => ({ text: job.data }) }),
        },
      }),
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(
    runtime.client.work.run.echo("hello", { timeoutMs: 800, job: { removeOnComplete: true } }),
  ).resolves.toEqual({ text: "hello" });
});

test("completion observation does not combine a current state with a stale result snapshot", async () => {
  lateEvents(200);
  const original = Object.getOwnPropertyDescriptor(Job.prototype, "getState")!
    .value as Job["getState"];
  vi.spyOn(Job.prototype, "getState").mockImplementation(async function (this: Job) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return original.call(this);
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    connection: redis.connection,
    queues: {
      work: defineQueue(crypto.randomUUID(), {
        jobs: {
          echo: defineJob({
            input: z.string(),
            handler: async (job) => {
              await new Promise((resolve) => setTimeout(resolve, 30));
              return { text: job.data };
            },
          }),
        },
      }),
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(runtime.client.work.run.echo("hello", { timeoutMs: 800 })).resolves.toEqual({
    text: "hello",
  });
});

test("a native delayed transition does not consume the shutdown grace period", async () => {
  let moved!: () => void;
  const transitioned = new Promise<void>((resolve) => {
    moved = resolve;
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    connection: redis.connection,
    shutdownTimeoutMs: 1000,
    queues: {
      work: defineQueue(crypto.randomUUID(), {
        jobs: {
          later: defineJob({
            input: z.string(),
            handler: async (job, token) => {
              await job.moveToDelayed(Date.now() + 60_000, token);
              moved();
              throw new DelayedError();
            },
          }),
        },
      }),
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  const job = await runtime.client.work.add.later("hello");
  await transitioned;
  await expect.poll(() => job.getState()).toBe("delayed");
  const started = Date.now();
  await runtime.close();
  expect(Date.now() - started).toBeLessThan(500);
});

test("closing during cursor setup cannot allocate an observer after cleanup", async () => {
  const runtime = createJobs({
    name: crypto.randomUUID(),
    connection: redis.connection,
    logging: false,
    queues: {
      work: defineQueue(crypto.randomUUID(), {
        jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
      }),
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  const factory = vi.spyOn(RedisConnection, "clientFactory");
  const backend = runtime.native("work").queue.getBackend();
  const publish = backend.publishEvent.bind(backend);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const cursorWritten = new Promise<void>((resolve) => (entered = resolve));
  vi.spyOn(backend, "publishEvent").mockImplementation(async (...args) => {
    const id = await publish(...args);
    entered();
    await gate;
    return id;
  });
  const outcome = runtime.client.work.run.echo("x", { timeoutMs: 1000 });
  const rejected = expect(outcome).rejects.toThrow("not started");
  await cursorWritten;
  await runtime.close();
  const allocations = factory.mock.calls.length;
  release();
  await rejected;
  expect(factory.mock.calls.length).toBe(allocations);
});

test("late worker validation cannot start a handler after forced shutdown", async () => {
  let release!: () => void;
  let entered!: () => void;
  let executions = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const validating = new Promise<void>((resolve) => (entered = resolve));
  const work = defineQueue(crypto.randomUUID(), {
    jobs: {
      echo: defineJob({
        input: z.string().superRefine(async () => {
          entered();
          await gate;
        }),
        handler: async () => {
          executions++;
          return "late";
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
    shutdownTimeoutMs: 10,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  // Native submission isolates worker validation from producer validation.
  await runtime.native("work").queue.add("echo", "x");
  await validating;
  await runtime.close();
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(executions).toBe(0);
});

test("abort during producer validation prevents submission", async () => {
  const validating = Promise.withResolvers<void>();
  const validated = Promise.withResolvers<void>();
  const work = defineQueue(crypto.randomUUID(), {
    jobs: {
      echo: defineJob({
        input: z.string().superRefine(async () => {
          validating.resolve();
          await validated.promise;
        }),
        handler: async (job) => job.data,
      }),
    },
  });
  const runtime = createJobs({
    name: work.name,
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  const add = vi.spyOn(runtime.native("work").queue, "add");
  const controller = new AbortController();
  const result = runtime.client.work.run.echo("x", { timeoutMs: 1000, signal: controller.signal });
  const rejected = expect(result).rejects.toThrow("cancelled");
  await validating.promise;
  controller.abort(new Error("cancelled"));
  await rejected;
  validated.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  expect(add).not.toHaveBeenCalled();
});

test("a transient reconciliation failure does not end the wait", async () => {
  const checked = Promise.withResolvers<void>();
  const work = defineQueue(crypto.randomUUID(), {
    jobs: {
      echo: defineJob({
        input: z.string(),
        handler: async (job) => {
          await checked.promise;
          return job.data;
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: work.name,
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  const backend = runtime.native("work").queue.getBackend();
  const isFinished = backend.isFinished.bind(backend);
  let reads = 0;
  vi.spyOn(backend, "isFinished").mockImplementation(async (...args) => {
    if (++reads === 2) {
      checked.resolve();
      throw new Error("transient Redis error");
    }
    return isFinished(...args);
  });
  await expect(runtime.client.work.run.echo("x", { timeoutMs: 4500 })).resolves.toBe("x");
  expect(reads).toBe(2);
});

test("retained results are reconciled before a short deadline when events are delayed", async () => {
  lateEvents(1000);
  const work = defineQueue(crypto.randomUUID(), {
    jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
  });
  const runtime = createWorkerRuntime({
    name: work.name,
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(runtime.client.work.run.echo("x", { timeoutMs: 600 })).resolves.toBe("x");
});

test("a handler may update its input before the run submission is acknowledged", async () => {
  const work = defineQueue(crypto.randomUUID(), {
    jobs: {
      echo: defineJob({
        input: z.string(),
        handler: async (job) => {
          await job.updateData("updated");
          return job.data;
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: work.name,
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  const queue = runtime.native("work").queue;
  const add = queue.add.bind(queue);
  vi.spyOn(queue, "add").mockImplementation(async (...args) => {
    const job = await add(...args);
    await expect.poll(() => job.getState()).toBe("completed");
    return job;
  });
  await expect(runtime.client.work.run.echo("submitted", { timeoutMs: 1500 })).resolves.toBe(
    "updated",
  );
});

test("a delayed Redis fetch cannot start a new attempt after shutdown", async () => {
  const fetched = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const consumed = Promise.withResolvers<void>();
  const handler = vi.fn(async () => "late");
  const work = defineQueue(crypto.randomUUID(), {
    jobs: { echo: defineJob({ input: z.string(), handler }) },
  });
  const runtime = createWorkerRuntime({
    name: work.name,
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  const { worker, queue } = runtime.native("work");
  const backend = worker!.getBackend();
  const processJob = worker!.processJob.bind(worker);
  vi.spyOn(worker!, "processJob").mockImplementation(async (...args) => {
    try {
      return await processJob(...args);
    } finally {
      consumed.resolve();
    }
  });
  const moveToActive = backend.moveToActive.bind(backend);
  vi.spyOn(backend, "moveToActive").mockImplementation(async (...args) => {
    const result = await moveToActive(...args);
    if (result[1]) {
      fetched.resolve();
      await release.promise;
    }
    return result;
  });
  await queue.add("echo", "x");
  await fetched.promise;
  await runtime.close();
  release.resolve();
  await consumed.promise;
  expect(handler).not.toHaveBeenCalled();
});

test("a non-DTO result fails instead of silently dropping class fields", async () => {
  const work = defineQueue(crypto.randomUUID(), {
    jobs: { error: defineJob({ input: z.string(), handler: async () => new Error("hidden") }) },
  });
  const runtime = createWorkerRuntime({
    name: work.name,
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(runtime.client.work.run.error("x", { timeoutMs: 1000 })).rejects.toThrow("plain");
});

test("inspection reads typed pending, terminal and missing snapshots through the same client", async () => {
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    connection: redis.connection,
    queues: {
      work: defineQueue(crypto.randomUUID(), {
        jobs: {
          echo: defineJob({ input: z.string().transform(Number), handler: (job) => job.data }),
          fail: defineJob({
            input: z.string(),
            handler: () => {
              throw new Error("business failure");
            },
          }),
        },
      }),
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  const { work } = runtime.client;
  const held = await work.add.echo("7", { delay: 60000 });
  expect(await work.inspect.echo(held.id!)).toMatchObject({ state: "pending", data: 7 });
  expect(await work.inspect.fail(held.id!)).toEqual({ state: "missing" });
  await held.promote();
  await expect
    .poll(() => work.inspect.echo(held.id!))
    .toMatchObject({ state: "completed", result: 7 });
  const failed = await work.add.fail("x");
  await expect
    .poll(() => work.inspect.fail(failed.id!))
    .toMatchObject({ state: "failed", reason: "business failure" });
  await failed.remove();
  expect(await work.inspect.fail(failed.id!)).toEqual({ state: "missing" });
});

test("draining permits an active handler's follow-up submission and rejects new external work", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const runtimeQueue = crypto.randomUUID();
  let enqueue: () => Promise<unknown>;
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    connection: redis.connection,
    queues: {
      work: defineQueue(runtimeQueue, {
        jobs: {
          first: defineJob({
            input: z.string(),
            handler: async () => {
              entered.resolve();
              await release.promise;
              await enqueue();
              return true;
            },
          }),
          next: defineJob({ input: z.string(), handler: (job) => job.data }),
        },
      }),
    },
  });
  runtimes.push(runtime);
  await runtime.start();
  enqueue = () => runtime.client.work.add.next("from handler");
  const result = runtime.client.work.run.first("start", { timeoutMs: 3000 });
  void result.catch(() => {});
  await entered.promise;
  const closed = runtime.close();
  await expect(runtime.client.work.add.next("from outside")).rejects.toThrow();
  release.resolve();
  await closed;
  await result.catch(() => {});
  const observer = createJobs({
    name: crypto.randomUUID(),
    connection: redis.connection,
    queues: { work: defineQueue(runtimeQueue, { jobs: {} }) },
  });
  runtimes.push(observer);
  await observer.start();
  expect(await observer.native("work").queue.getWaitingCount()).toBe(1);
  expect(await observer.native("work").queue.getCompletedCount()).toBe(1);
});
