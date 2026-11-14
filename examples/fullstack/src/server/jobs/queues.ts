import { defineQueue } from "@prinpo/stack/jobs";

import { formatMessage } from "./format-message";

export const queues = {
  utilities: defineQueue("utilities", {
    jobs: { formatMessage },
    worker: { concurrency: 4 },
    defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
  }),
};

export type Queues = typeof queues;
