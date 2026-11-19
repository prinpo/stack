import { createJobs, defineJob, defineJobContext, defineQueue, z } from "@prinpo/stack/jobs";
import { createJobsClient } from "@prinpo/stack/jobs/client";
import { jobsPlugin } from "@prinpo/stack/jobs/elysia";
import { Elysia } from "@prinpo/stack/server";
/* oxlint-disable typescript/no-floating-promises -- Compile-only calls verify rejected inputs. */
import { expectTypeOf, test } from "vite-plus/test";

test("the client derives names, inputs, results, phases and retrieval unions from definitions", () => {
  const appJob = defineJobContext(() => ({ label: "count" }));
  const queues = {
    work: defineQueue("work", {
      jobs: {
        count: appJob({
          input: z.object({ value: z.string().transform(Number) }),
          phases: ["fetching", "saving"],
          handler: async (job, context) => {
            expectTypeOf(context.label).toEqualTypeOf<string>();
            expectTypeOf(context.logger).toEqualTypeOf<typeof job.logger>();
            expectTypeOf(job.data.value).toEqualTypeOf<number>();
            expectTypeOf(job.native?.data.value).toEqualTypeOf<string | undefined>();
            await job.updateData({ value: "21" });
            // @ts-expect-error worker updates also accept schema input, not transformed output
            await job.updateData({ value: 21 });
            await job.updateProgress({ phase: "saving", percent: 100 });
            return { count: job.data.value };
          },
        }),
        plain: defineJob({ input: z.boolean(), handler: async (job) => job.data }),
      },
    }),
  };
  const client = createJobsClient<typeof queues>();
  async function compileOnly() {
    const result = await client.work.run.count({ value: "42" }, { timeoutMs: 500 });
    expectTypeOf(result).toEqualTypeOf<{ count: number | null }>();
    const found = await client.work.getJob.count("id");
    expectTypeOf(found?.data).toEqualTypeOf<{ value: number } | undefined>();
    await found?.updateData({ value: "21" });
    // @ts-expect-error updates accept schema input, not transformed output
    await found?.updateData({ value: 21 });
    // @ts-expect-error custom phases are required on progress updates
    await found?.updateProgress({ percent: 50 });
    // @ts-expect-error phase names are inferred literals
    await found?.updateProgress({ phase: "unknown", percent: 50 });
    const plain = await client.work.add.plain(true);
    await plain.updateProgress({ percent: 50 });
    // @ts-expect-error the default phase is processing
    await plain.updateProgress({ phase: "other", percent: 50 });
    const job = await client.work.getJob("id");
    if (job?.name === "count") expectTypeOf(job.data.value).toEqualTypeOf<number>();
    if (job?.name === "plain") expectTypeOf(job.data).toEqualTypeOf<boolean>();
    // @ts-expect-error input schemas control producer inputs
    client.work.add.count({ value: 42 });
    // @ts-expect-error each job retains its own input shape
    client.work.add.plain("wrong");
    // @ts-expect-error unknown job names are rejected
    client.work.add.missing({});
    // @ts-expect-error unknown queues are rejected
    client.missing.add.count({ value: "42" });
    // @ts-expect-error waiting requires a finite timeout argument
    client.work.run.plain(true);
  }
  void compileOnly;
});

test("transported results describe JSON while handlers keep their native values", () => {
  type JsonResult<T> = import("@prinpo/stack/jobs").JsonResult<T>;
  expectTypeOf<
    JsonResult<{
      date: Date;
      value: number;
      optional: string | undefined;
      omitted: undefined;
      fn: () => void;
    }>
  >().toEqualTypeOf<{ date: string | null; value: number | null; optional?: string }>();
  expectTypeOf<JsonResult<readonly [Date, undefined, () => void, symbol, 42]>>().toEqualTypeOf<
    [string | null, null, null, null, 42]
  >();
  expectTypeOf<JsonResult<{ toJSON(): { value: string } }>>().toEqualTypeOf<{ value: string }>();
  expectTypeOf<JsonResult<void>>().toEqualTypeOf<null>();
  const job = defineJob({ input: z.string(), handler: async () => ({ createdAt: new Date() }) });
  const queues = { work: defineQueue("types", { jobs: { job } }) };
  const client = createJobsClient<typeof queues>();
  async function compileOnly() {
    const result = await client.work.run.job("x", { timeoutMs: 1000 });
    expectTypeOf(result.createdAt).toEqualTypeOf<string | null>();
  }
  void compileOnly;
});

test("injecting an existing runtime into Elysia preserves its exact client contract", () => {
  const queues = {
    work: defineQueue("injected-types", {
      jobs: {
        echo: defineJob({ input: z.string(), handler: async (job) => ({ text: job.data }) }),
      },
    }),
  };
  const runtime = createJobs({ queues, connection: { host: "127.0.0.1" } });
  const app = new Elysia().use(jobsPlugin(runtime));
  expectTypeOf(app.decorator.jobs).toEqualTypeOf<typeof runtime.client>();
});

test("a loaded handler supplies its input and result to inspection and run", () => {
  const loaded = defineJob({
    input: z.string().transform(Number),
    phases: ["saving"],
    load: async (resources) => {
      resources.defer(() => {});
      return async (job) => {
        expectTypeOf(job.data).toEqualTypeOf<number>();
        expectTypeOf(job.moveToWait).returns.toEqualTypeOf<Promise<void>>();
        await job.updateProgress({ phase: "saving", percent: 100 });
        return { value: job.data };
      };
    },
  });
  const queues = { work: defineQueue("work", { jobs: { loaded } }) };
  const client = createJobsClient<typeof queues>();
  async function compileOnly() {
    const snapshot = await client.work.inspect.loaded("id");
    if (snapshot.state === "completed") {
      expectTypeOf(snapshot.result).toEqualTypeOf<{ value: number | null }>();
      expectTypeOf(snapshot.progress.phase).toEqualTypeOf<"processing" | "saving">();
    }
    const job = await client.work.getJob.loaded("id");
    expectTypeOf(job!.moveToWait).returns.toEqualTypeOf<Promise<number>>();
  }
  void compileOnly;
});
