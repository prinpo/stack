import { defineQueue } from "@prinpo/stack/jobs";

import { ENV } from "../../../../env-gen/server";
import { formatMessage } from "./format-message";
import { saveMessage } from "./save-message";

export default defineQueue("utilities", {
  jobs: { formatMessage, saveMessage },
  worker: { concurrency: ENV.JOBS_CONCURRENCY },
  options: {
    defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
  },
});
