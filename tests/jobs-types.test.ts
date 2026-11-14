import { defineJob, defineQueue, z } from "@prinpo/stack/jobs";
import { createJobsClient } from "@prinpo/stack/jobs/client";
/* oxlint-disable typescript/no-floating-promises -- Compile-only calls verify rejected inputs. */
import { expectTypeOf, test } from "vite-plus/test";

test("the client derives names, inputs, results, phases and retrieval unions from definitions", () => {
  const queues = {
    work: defineQueue("work", {
      jobs: {
        count: defineJob({
          input: z.object({ value: z.string().transform(Number) }),
          phases: ["fetching", "saving"],
          handler: async (job) => {
            expectTypeOf(job.data.value).toEqualTypeOf<number>();
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
    expectTypeOf(result).toEqualTypeOf<{ count: number }>();
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
