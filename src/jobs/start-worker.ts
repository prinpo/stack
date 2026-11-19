import type { ServerEnvOptions } from "../env/server";
import type { CreateJobsOptions, QueueDefinitions } from "./types";

import { loadServerEnv } from "../env/server";
import { jobsCleanupTimeoutMs } from "./lifecycle";
import { createWorkerRuntime } from "./runtime";

/** Own the host from environment loading through the last application cleanup. */
export async function startJobsWorker<const Q extends QueueDefinitions>(
  load: () => Promise<{ jobs: CreateJobsOptions<Q> }>,
  { env }: { env?: Omit<ServerEnvOptions, "client"> } = {},
) {
  const check = process.env._STACK_JOBS_CHECK === "1";
  const loading = loadServerEnv({ ...env, client: false })
    .then(load)
    .then(({ jobs }) => createWorkerRuntime(jobs, check ? "check" : "worker"));
  let host: Awaited<typeof loading> | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        await (await loading).close();
      } finally {
        process.off("SIGTERM", terminate);
        process.off("SIGINT", interrupt);
      }
    })());
  const stop = (status: number) => {
    if (closing) return;
    process.exitCode = status;
    setTimeout(
      () => process.exit(process.exitCode ?? status),
      Math.min(2147483647, (host?.shutdownTimeoutMs ?? 30000) + jobsCleanupTimeoutMs),
    ).unref();
    void close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    host = await loading;
    if (!closing) await host.start();
    if (closing || check) await close();
    return Object.assign({}, host, { close });
  } catch (error) {
    const interrupted = !!closing;
    await close();
    if (interrupted && host) return Object.assign({}, host, { close });
    throw error;
  }
}
