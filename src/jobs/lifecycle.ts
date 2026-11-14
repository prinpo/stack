import { injectedEnvironment } from "../env/environment";
import { duration } from "./deadline";

export const jobsLifecycle = "__prinpoJobsLifecycle";
export const jobsCleanupTimeoutMs = 2500;
interface JobsLifecycle {
  start(): Promise<void>;
  close(): Promise<void>;
  shutdownTimeoutMs: number;
}
type Host = { decorator: Record<string, unknown> };

function installed(app: Host): JobsLifecycle | undefined {
  return app.decorator[jobsLifecycle] as JobsLifecycle | undefined;
}

export function configuredJobsShutdownTimeout() {
  const snapshot = injectedEnvironment()?.config.JOBS_SHUTDOWN_TIMEOUT_MS?.value;
  return duration(
    Number(snapshot ?? process.env.JOBS_SHUTDOWN_TIMEOUT_MS ?? 30_000),
    "JOBS_SHUTDOWN_TIMEOUT_MS",
    true,
  );
}

export async function startApplicationJobs(app: Host) {
  await installed(app)?.start();
}
export async function closeApplicationJobs(app: Host) {
  await installed(app)?.close();
}

export function applicationJobsShutdownTimeout(app: Host) {
  return installed(app)?.shutdownTimeoutMs;
}
