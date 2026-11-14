import { createJobsClient } from "@prinpo/stack/jobs/client";

import type { Queues } from "./queues";

/** Reuse in backend helpers that run outside an Elysia request context. */
export const jobs = createJobsClient<Queues>();
