import { Queue, createJobs, defineJob, defineQueue, z } from "@prinpo/stack/jobs";
import { createJobsClient } from "@prinpo/stack/jobs/client";
import { afterAll, afterEach, beforeAll, expect, test } from "vite-plus/test";

import { testRedis } from "./test-utils/redis";

let redis: ReturnType<typeof testRedis>;
const runtimes: { close(): Promise<void> }[] = [];
beforeAll(() => {
  redis = testRedis();
}, 60_000);
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});
afterAll(() => {
  redis?.close();
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
  const runtime = createJobs({
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
  const runtime = createJobs({
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
  const runtime = createJobs({
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
  const runtime = createJobs({
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
  const runtime = createJobs({ name, queues, connection: redis.connection });
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
  const runtime = createJobs({
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
    defaultJobOptions: { attempts: 2, delay: 60_000, backoff: { type: "fixed", delay: 10 } },
    jobs: {
      echo: defineJob({
        input: z.string(),
        defaults: { attempts: 3 },
        handler: async (job) => job.data,
      }),
    },
  });
  const runtime = createJobs({
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
  const runtime = createJobs({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  await expect(
    runtime.client.work.run.echo("hello", { timeoutMs: 0, job: { jobId: "invalid-timeout" } }),
  ).rejects.toThrow("timeoutMs");
  expect(await runtime.client.work.getJob("invalid-timeout")).toBeUndefined();
});

test("a run timeout stops waiting while the accepted job can still complete", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = defineQueue(`wait-${crypto.randomUUID()}`, {
    jobs: {
      echo: defineJob({
        input: z.string(),
        handler: async (job) => {
          await gate;
          return job.data;
        },
      }),
    },
  });
  const runtime = createJobs({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  try {
    await expect(
      runtime.client.work.run.echo("hello", { timeoutMs: 100, job: { jobId: "still-running" } }),
    ).rejects.toThrow();
  } finally {
    release();
  }
  await expect
    .poll(async () => (await runtime.client.work.getJob.echo("still-running"))?.getState())
    .toBe("completed");
  expect((await runtime.client.work.getJob.echo("still-running"))?.returnvalue).toBe("hello");
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
  const runtime = createJobs({
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

test("reused job IDs retain the stored input and cannot return another job kind's result", async () => {
  const work = defineQueue(`identity-${crypto.randomUUID()}`, {
    jobs: {
      text: defineJob({ input: z.string(), handler: async (job) => ({ text: job.data }) }),
      number: defineJob({ input: z.number(), handler: async (job) => ({ number: job.data }) }),
    },
  });
  const runtime = createJobs({
    name: crypto.randomUUID(),
    queues: { work },
    connection: redis.connection,
  });
  runtimes.push(runtime);
  await runtime.start();
  await runtime.client.work.run.text("first", { timeoutMs: 1000, job: { jobId: "shared" } });
  const duplicate = await runtime.client.work.add.text("second", { jobId: "shared" });
  expect(duplicate.data).toBe("first");
  await expect(
    runtime.client.work.run.number(42, { timeoutMs: 1000, job: { jobId: "shared" } }),
  ).rejects.toThrow("job kind");
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
  const runtime = createJobs({
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
