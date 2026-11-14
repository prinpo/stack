import { jobsPlugin } from "@prinpo/stack/jobs/elysia";
import { Elysia } from "@prinpo/stack/server";

import { ENV } from "../../env-gen/server";
import { authHelpers } from "../auth/instance";
import { queues } from "../jobs/queues";
import { logging } from "./logging";

export const setupPlugin = new Elysia({ name: "stack-example:setup" })
  .use(logging)
  .use(authHelpers.elysia())
  .use(
    jobsPlugin({
      queues,
      connection: { url: ENV.JOBS_REDIS_URL },
      prefix: `stack-example:${ENV.APP_ENV}`,
    }),
  );
