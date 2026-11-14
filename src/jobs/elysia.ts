import { Elysia } from "elysia";

import type { CreateJobsOptions, QueueDefinitions } from "./types";

import { jobsLifecycle } from "./lifecycle";
import { createJobs } from "./runtime";

export { startApplicationJobs as startJobs, closeApplicationJobs as stopJobs } from "./lifecycle";

/** Reuse one plugin instance through setup; Stack starts it at the pre-listen gate. */
export function jobsPlugin<const Q extends QueueDefinitions>(options: CreateJobsOptions<Q>) {
  const runtime = createJobs(options);
  return new Elysia({ name: "prinpo:jobs", seed: options.name ?? "default" })
    .decorate(jobsLifecycle, runtime)
    .decorate("jobs", runtime.client)
    .onStop(() => runtime.close());
}
