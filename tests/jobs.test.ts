import { Queue, createJobs, defineJob, defineQueue, z } from "@prinpo/stack/jobs";
import { createJobsClient } from "@prinpo/stack/jobs/client";
import { afterAll, afterEach, beforeAll, expect, test } from "vite-plus/test";

import { createWorkerRuntime } from "../src/jobs/runtime";
import { type TestRedis, testRedis } from "./test-utils/redis";

let redis: TestRedis;
const runtimes: { close(): Promise<void> }[] = [];
beforeAll(async () => {
  redis = await testRedis();
}, 60_000);
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});
afterAll(() => redis?.close());

test.each(["default", "sync", "async"] as const)(
  "%s job IDs use the same generator for add and run",
  async (mode) => {
    let calls = 0;
    const allocate = () => `custom-${++calls}`;
    const runtime = createWorkerRuntime({
      name: crypto.randomUUID(),
      connection: redis.connection,
      queues: {
        work: defineQueue(crypto.randomUUID(), {
          jobs: { identify: defineJob({ input: z.string(), handler: (job) => job.id }) },
        }),
      },
      generateJobId:
        mode === "default" ? undefined : mode === "sync" ? allocate : async () => allocate(),
    });
    runtimes.push(runtime);
    await runtime.start();
    const work = runtime.client.work;
    const explicit = await work.add.identify("manual", { jobId: "manual-id" });
    expect(explicit.id).toBe("manual-id");
    expect(calls).toBe(0);
    const queued = await work.add.identify("queued");
    const ran = await work.run.identify("waited", { timeoutMs: 3000 });
    if (mode === "default") {
      expect(z.uuidv7().safeParse(queued.id).success).toBe(true);
      expect(z.uuidv7().safeParse(ran).success).toBe(true);
      expect(queued.id).not.toBe(ran);
    } else {
      expect([queued.id, ran]).toEqual(["custom-1", "custom-2"]);
      expect(calls).toBe(2);
    }
  },
);

test("failed, invalid and abandoned ID allocations never enqueue work", async () => {
  const pending = Promise.withResolvers<string>();
  const entered = Promise.withResolvers<void>();
  let allocate = async () => "";
  const runtime = createJobs({
    name: crypto.randomUUID(),
    connection: redis.connection,
    operationTimeoutMs: 100,
    queues: {
      work: defineQueue(crypto.randomUUID(), {
        jobs: { echo: defineJob({ input: z.string(), handler: (job) => job.data }) },
      }),
    },
    generateJobId: () => allocate(),
  });
  runtimes.push(runtime);
  await runtime.start();
  const work = runtime.client.work;
  for (const id of ["", "42", "queue:id"]) {
    allocate = async () => id;
    await expect(work.add.echo("data")).rejects.toThrow("generateJobId");
    await expect(work.run.echo("data", { timeoutMs: 500 })).rejects.toThrow("generateJobId");
  }
  allocate = async () => {
    throw new Error("allocator unavailable");
  };
  await expect(work.add.echo("data")).rejects.toThrow("allocator unavailable");
  allocate = () => {
    entered.resolve();
    return pending.promise;
  };
  const controller = new AbortController();
  const run = work.run.echo("data", { timeoutMs: 500, signal: controller.signal });
  await entered.promise;
  controller.abort(new Error("cancel allocation"));
  await expect(run).rejects.toThrow("cancel allocation");
  await expect(work.add.echo("data")).rejects.toThrow("ID generation timeout");
  pending.resolve("late-id");
  expect(await runtime.native("work").queue.getWaitingCount()).toBe(0);

  const closingAllocation = Promise.withResolvers<string>();
  const allocating = Promise.withResolvers<void>();
  allocate = () => {
    allocating.resolve();
    return closingAllocation.promise;
  };
  const closed = expect(work.run.echo("data", { timeoutMs: 500 })).rejects.toThrow(
    "runtime is closed",
  );
  await allocating.promise;
  await runtime.close();
  await closed;
  closingAllocation.resolve("after-close");
});

test("a backend submits a job and waits for its inferred result", async () => {
  const emails = defineQueue(`emails-${crypto.randomUUID()}`, {
    jobs: {
      sendEmail: defineJob({
        input: z.object({ to: z.email() }),
        handler: async (job) => ({ recipient: job.data.to }),
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { emails },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  const result = await runtime.client.emails.run.sendEmail(
    { to: "hello@example.com" },
    { timeoutMs: 3000 },
  );
  expect(result).toEqual({ recipient: "hello@example.com" });
});

test("serialized input is validated before enqueueing and transformed independently by the worker", async () => {
  const numbers = defineQueue(`numbers-${crypto.randomUUID()}`, {
    jobs: {
      double: defineJob({
        input: z.object({ value: z.string().transform(async (value) => Number(value)) }),
        handler: async (job) => ({ doubled: job.data.value * 2, type: typeof job.data.value }),
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { numbers },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(
    Reflect.apply(runtime.client.numbers.add.double, undefined, [{ value: 123 }]),
  ).rejects.toThrow("validation");
  const result = await runtime.client.numbers.run.double({ value: "21" }, { timeoutMs: 3000 });
  expect(result).toEqual({ doubled: 42, type: "number" });
});

test("retrieval checks job identity and exposes validated data without changing the stored input", async () => {
  const work = defineQueue(`lookup-${crypto.randomUUID()}`, {
    jobs: {
      count: defineJob({ input: z.string().transform(Number), handler: async (job) => job.data }),
      other: defineJob({ input: z.boolean(), handler: async (job) => job.data }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  const added = await runtime.client.work.add.count("21", { delay: 60_000 });
  expect(added.data).toBe(21);
  const found = await runtime.client.work.getJob.count(added.id!);
  expect(found?.data).toBe(21);
  expect(await runtime.client.work.getJob.other(added.id!)).toBeUndefined();
  expect(await runtime.client.work.getJob.count("missing")).toBeUndefined();
  await found!.updateData("42");
  const again = await runtime.client.work.getJob(added.id!);
  expect(again?.data).toBe(42);
  expect(again?.name).toBe("count");
});

test("progress always has a phase and percent and custom phases are checked", async () => {
  const work = defineQueue(`progress-${crypto.randomUUID()}`, {
    jobs: {
      plain: defineJob({
        input: z.string(),
        handler: async (job) => {
          await job.updateProgress({ percent: 12.5 });
          return job.progress;
        },
      }),
      phased: defineJob({
        input: z.string(),
        phases: ["downloading", "indexing"],
        handler: async (job) => {
          await job.updateProgress({ phase: "indexing", percent: 80 });
          return job.progress;
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  const queued = await runtime.client.work.add.phased("hello", { delay: 60_000 });
  expect(queued.progress).toEqual({ phase: "processing", percent: 0 });
  await expect(Reflect.apply(queued.updateProgress, queued, [{ percent: 20 }])).rejects.toThrow(
    "phase",
  );
  await expect(
    Reflect.apply(queued.updateProgress, queued, [{ phase: "unknown", percent: 20 }]),
  ).rejects.toThrow("phase");
  await expect(queued.updateProgress({ phase: "indexing", percent: 101 })).rejects.toThrow(
    "percent",
  );
  expect(await runtime.client.work.run.plain("hello", { timeoutMs: 3000 })).toEqual({
    phase: "processing",
    percent: 12.5,
  });
  expect(await runtime.client.work.run.phased("hello", { timeoutMs: 3000 })).toEqual({
    phase: "indexing",
    percent: 80,
  });
});

test("a type-only client resolves the registered runtime and rejects calls outside its lifetime", async () => {
  const work = defineQueue(`client-${crypto.randomUUID()}`, {
    jobs: {
      echo: defineJob({ input: z.string(), handler: async (job) => ({ echoed: job.data }) }),
    },
  });
  const queues = { work };
  const name = crypto.randomUUID();
  const client = createJobsClient<typeof queues>({ name });
  await expect(client.work.add.echo("before startup")).rejects.toThrow("not started");
  const runtime = createWorkerRuntime({ name, queues, connection: redis.connection });
  runtimes.push(runtime);
  await runtime.start();
  expect(await client.work.run.echo("hello", { timeoutMs: 3000 })).toEqual({ echoed: "hello" });
  await runtime.close();
  await expect(client.work.add.echo("after shutdown")).rejects.toThrow("not started");
});

test("malformed external jobs fail without retrying and cannot be retrieved as valid data", async () => {
  const work = defineQueue(`external-${crypto.randomUUID()}`, {
    jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  const external = new Queue(work.name, { connection: redis.connection });
  runtimes.push(external);
  const invalid = await external.add("echo", 42, { attempts: 5 });
  const unknown = await external.add("missing", {}, { attempts: 5 });
  await expect.poll(async () => (await external.getJob(invalid.id!))?.getState()).toBe("failed");
  await expect.poll(async () => (await external.getJob(unknown.id!))?.getState()).toBe("failed");
  expect((await external.getJob(invalid.id!))?.attemptsMade).toBe(1);
  await expect(runtime.client.work.getJob.echo(invalid.id!)).rejects.toThrow("validation");
  expect(await runtime.client.work.getJob.echo(unknown.id!)).toBeUndefined();
});

test("native job options layer queue defaults, job defaults, and submission overrides", async () => {
  const work = defineQueue(`defaults-${crypto.randomUUID()}`, {
    options: {
      defaultJobOptions: { attempts: 2, delay: 60_000, backoff: { type: "fixed", delay: 10 } },
    },
    jobs: {
      echo: defineJob({
        input: z.string(),
        defaults: { attempts: 3 },
        handler: async (job) => job.data,
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  const inherited = await runtime.client.work.add.echo("hello");
  expect(inherited.opts.attempts).toBe(3);
  expect(inherited.opts.delay).toBe(60_000);
  const overridden = await runtime.client.work.add.echo("hello", { attempts: 4 });
  expect(overridden.opts.attempts).toBe(4);
  expect(overridden.opts.backoff).toEqual({ type: "fixed", delay: 10 });
});

test("run rejects an invalid timeout before submitting work", async () => {
  const work = defineQueue(`timeout-${crypto.randomUUID()}`, {
    jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(runtime.client.work.run.echo("hello", { timeoutMs: 0 })).rejects.toThrow(
    "timeoutMs",
  );
  expect(await runtime.native("work").queue.count()).toBe(0);
});

test("a run timeout stops waiting while the accepted job can still complete", async () => {
  const accepted = Promise.withResolvers<string | undefined>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = defineQueue(`wait-${crypto.randomUUID()}`, {
    jobs: {
      echo: defineJob({
        input: z.string(),
        handler: async (job) => {
          accepted.resolve(job.id);
          await gate;
          return job.data;
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  try {
    await expect(runtime.client.work.run.echo("hello", { timeoutMs: 250 })).rejects.toThrow(
      "completion timeout",
    );
  } finally {
    release();
  }
  const id = await accepted.promise;
  await expect
    .poll(async () => (await runtime.client.work.getJob.echo(id!))?.getState())
    .toBe("completed");
  expect((await runtime.client.work.getJob.echo(id!))?.returnvalue).toBe("hello");
});

test("run observes native retries, terminal failures, and automatically removed results", async () => {
  const work = defineQueue(`outcomes-${crypto.randomUUID()}`, {
    jobs: {
      retry: defineJob({
        input: z.boolean(),
        handler: async (job) => {
          if (!job.data || job.attemptsMade < 1) throw new Error("try again");
          return { attempts: job.attemptsMade + 1 };
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  expect(
    await runtime.client.work.run.retry(true, {
      timeoutMs: 3000,
      job: { attempts: 2, removeOnComplete: true },
    }),
  ).toEqual({ attempts: 2 });
  await expect(
    runtime.client.work.run.retry(false, { timeoutMs: 3000, job: { attempts: 2 } }),
  ).rejects.toThrow("try again");
});

test("a runtime rejects competing definitions for one native queue before opening connections", () => {
  const job = defineJob({ input: z.string(), handler: async (job) => job.data });
  expect(() =>
    createJobs({
      connection: redis.connection,
      queues: {
        first: defineQueue("shared", { jobs: { first: job } }),
        second: defineQueue("shared", { jobs: { second: job } }),
      },
    }),
  ).toThrow("Duplicate queue");
});

test("add with a reused ID returns the stored input and rejects another job kind", async () => {
  const work = defineQueue(`identity-${crypto.randomUUID()}`, {
    jobs: {
      text: defineJob({ input: z.string(), handler: async (job) => ({ text: job.data }) }),
      number: defineJob({ input: z.number(), handler: async (job) => ({ number: job.data }) }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  await runtime.client.work.add.text("first", { jobId: "shared" });
  const duplicate = await runtime.client.work.add.text("second", { jobId: "shared" });
  expect(duplicate.data).toBe("first");
  await expect(runtime.client.work.add.number(42, { jobId: "shared" })).rejects.toThrow("job kind");
  await runtime.client.work.add.text("pending", {
    delay: 60_000,
    deduplication: { id: "shared-dedup" },
  });
  await expect(
    runtime.client.work.add.number(42, { deduplication: { id: "shared-dedup" } }),
  ).rejects.toThrow("job kind");
});

test("closing a runtime promptly rejects its unfinished run calls and releases their waits", async () => {
  let entered!: () => void;
  const active = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const work = defineQueue(`closing-wait-${crypto.randomUUID()}`, {
    jobs: {
      hold: defineJob({
        input: z.string(),
        handler: async (job, _token, signal) => {
          entered();
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
          return job.data;
        },
      }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
    shutdownTimeoutMs: 10,
  });
  runtimes.push(runtime);
  await runtime.start();
  let outcome = "pending";
  const running = runtime.client.work.run.hold("hello", { timeoutMs: 1500 }).then(
    () => {
      outcome = "completed";
    },
    (error) => {
      outcome = error.message;
    },
  );
  await active;
  await runtime.close();
  await expect.poll(() => outcome, { timeout: 300 }).toContain("closed");
  await running;
});

test("run rejects coalescing options and owns a fresh execution identity", async () => {
  const work = defineQueue(crypto.randomUUID(), {
    jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  const customId = { jobId: "retained" };
  const deduplication = { deduplication: { id: "shared" } };
  await runtime.client.work.add.echo("original", customId);
  await expect(
    runtime.client.work.run.echo("new", {
      timeoutMs: 1000,
      // @ts-expect-error exercise the runtime guard for untyped callers
      job: customId,
    }),
  ).rejects.toThrow("fresh job");
  await expect(
    runtime.client.work.run.echo("new", {
      timeoutMs: 1000,
      // @ts-expect-error exercise the runtime guard for untyped callers
      job: deduplication,
    }),
  ).rejects.toThrow("fresh job");
  await expect(runtime.client.work.run.echo("new", { timeoutMs: 1000 })).resolves.toBe("new");
  expect((await runtime.client.work.getJob.echo("retained"))?.data).toBe("original");
});

test("run transports JSON results and normalizes a void handler to null", async () => {
  const work = defineQueue(crypto.randomUUID(), {
    jobs: {
      value: defineJob({
        input: z.string(),
        handler: async () => ({
          date: new Date("2026-01-01T00:00:00Z"),
          invalid: new Date("invalid"),
          omitted: undefined,
          items: [undefined, Infinity],
          nested: { toJSON: () => ({ text: "encoded" }) },
        }),
      }),
      empty: defineJob({ input: z.string(), handler: async () => {} }),
    },
  });
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  expect(await runtime.client.work.run.value("x", { timeoutMs: 1000 })).toEqual({
    date: "2026-01-01T00:00:00.000Z",
    invalid: null,
    items: [null, null],
    nested: { text: "encoded" },
  });
  expect(await runtime.client.work.run.empty("x", { timeoutMs: 1000 })).toBeNull();
});

test("aborting a run releases the wait while accepted work remains queued", async () => {
  const work = defineQueue(crypto.randomUUID(), {
    jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
  });
  const runtime = createJobs({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
    logging: false,
  });
  runtimes.push(runtime);
  await runtime.start();
  const signal = new AbortController();
  const outcome = runtime.client.work.run.echo("x", {
    timeoutMs: 5000,
    signal: signal.signal,
  });
  const rejection = expect(outcome).rejects.toThrow("stop waiting");
  const queue = runtime.native("work").queue;
  await expect.poll(() => queue.getWaitingCount()).toBe(1);
  signal.abort(new Error("stop waiting"));
  await rejection;
  expect(await queue.getWaitingCount()).toBe(1);
});

test("job logging reports retries and persisted completion without attaching payloads", async () => {
  const { initLogger } = await import("@prinpo/stack/logger");
  const events: import("@prinpo/stack/logger").DrainContext[] = [];
  initLogger({
    silent: true,
    drain: (ctx) => {
      events.push(ctx);
    },
  });
  try {
    const work = defineQueue(crypto.randomUUID(), {
      jobs: {
        echo: defineJob({
          input: z.string(),
          handler: async (job) => {
            job.logger.set({ operationId: "business-operation" });
            if (job.attemptsMade === 0) throw new Error("retry me");
            return job.data;
          },
        }),
      },
    });
    const runtime = createWorkerRuntime({
      name: crypto.randomUUID(),
      queues: { work },
      connection: redis.connection,
    });
    runtimes.push(runtime);
    await runtime.start();
    expect(
      await runtime.client.work.run.echo("private-payload-marker", {
        timeoutMs: 2000,
        job: { attempts: 2 },
      }),
    ).toBe("private-payload-marker");
    await expect.poll(() => events.some((ctx) => ctx.event.event === "job.completed")).toBe(true);
    expect(events.some((ctx) => ctx.event.event === "job.retrying")).toBe(true);
    expect(events.some((ctx) => ctx.event.operationId === "business-operation")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private-payload-marker");
  } finally {
    initLogger({ silent: true });
  }
});
