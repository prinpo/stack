import { Elysia } from "@prinpo/stack/server";

import { setupPlugin } from "../plugins/setup";
import { formatMessageInput } from "../validation/messages";

export const jobRoutes = new Elysia()
  .use(setupPlugin)
  .post(
    "/api/jobs/format",
    ({ body, jobs }) => jobs.utilities.run.formatMessage(body, { timeoutMs: 5000 }),
    { body: formatMessageInput },
  )
  .post(
    "/api/jobs/format/queued",
    async ({ body, jobs }) => {
      const job = await jobs.utilities.add.formatMessage(body);
      return { id: job.id };
    },
    { body: formatMessageInput },
  )
  .get("/api/jobs/format/:id", async ({ params, jobs, apiError }) => {
    const job = await jobs.utilities.getJob.formatMessage(params.id);
    if (!job)
      return apiError(404, {
        message: "Job not found",
        code: "JOB_NOT_FOUND",
        data: { jobId: params.id },
      });
    return {
      id: job.id,
      data: job.data,
      progress: job.progress,
      state: await job.getState(),
      result: job.returnvalue,
    };
  });
