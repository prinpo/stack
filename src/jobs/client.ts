import type { JobsClient, QueueDefinitions } from "./types";

import { dispatchJob } from "./registry";

export type { JobsClient } from "./types";

/** A process-local typed facade. Importing this module starts no connections or workers. */
export function createJobsClient<Q extends QueueDefinitions>({
  name = "default",
}: { name?: string } = {}): JobsClient<Q> {
  const queues = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get(_, alias) {
        if (typeof alias !== "string" || alias === "then") return undefined;
        if (!queues.has(alias)) {
          const named = (operation: "add" | "run" | "getJob" | "inspect") => ({
            get(_: unknown, job: string | symbol) {
              if (typeof job !== "string" || job === "then") return undefined;
              return (...args: unknown[]) => dispatchJob(name, alias, operation, job, args);
            },
          });
          queues.set(alias, {
            inspect: new Proxy({}, named("inspect")),
            add: new Proxy({}, named("add")),
            run: new Proxy({}, named("run")),
            getJob: new Proxy(
              (id: string) => dispatchJob(name, alias, "getJob", undefined, [id]),
              named("getJob"),
            ),
          });
        }
        return queues.get(alias);
      },
    },
  ) as JobsClient<Q>;
}
