import { Job, UnrecoverableError } from "bullmq";
import { createLogger } from "evlog";

import type { AnyJob, QueueDefinition } from "./types";
import type { ProcessingJob } from "./worker";

import { serializeResult } from "./serialization";
import { JobValidationError, jobView, validateInput } from "./validation";

export async function processDefinedJob(
  queue: QueueDefinition,
  job: ProcessingJob,
  token?: string,
  signal?: AbortSignal,
  logging = true,
) {
  const checkCancellation = () => {
    if (signal?.aborted)
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("Job processing aborted", { cause: signal.reason });
  };
  checkCancellation();
  const contract: AnyJob | undefined = Object.hasOwn(queue.jobs, job.name)
    ? queue.jobs[job.name]
    : undefined;
  if (!contract) throw new UnrecoverableError(`Unknown job '${job.name}'`);
  let data: unknown;
  try {
    data = await validateInput(contract, job.data, job.name);
  } catch (error) {
    if (error instanceof JobValidationError) throw new UnrecoverableError(error.message);
    throw error;
  }
  checkCancellation();
  const logger = createLogger({
    queue: queue.name,
    jobName: job.name,
    jobId: Reflect.get(job, "id"),
    attempt: Number(Reflect.get(job, "attemptsMade") ?? 0) + 1,
  });
  const view = jobView(job, contract, data);
  const context = new Proxy(view, {
    get(target, key) {
      if (key === "moveToWait")
        return async (lock?: string) => {
          await target.moveToWait(lock);
        };
      if (key === "logger") return logger;
      if (key === "native") return job instanceof Job ? job : undefined;
      return Reflect.get(target, key);
    },
  });
  // The registry erases individual handler types; validation restores its contract here.
  if (!("handler" in contract)) throw new Error("Job handler was not initialized");
  const handler = contract.handler as (
    job: unknown,
    token?: string,
    signal?: AbortSignal,
  ) => unknown;
  const started = performance.now();
  try {
    const result = serializeResult(await handler(context, token, signal));
    logger.set({ event: "job.handler.completed" });
    return result;
  } catch (error) {
    logger.set({ event: "job.handler.exited" });
    if (
      error instanceof Error &&
      !["DelayedError", "WaitingError", "WaitingChildrenError", "RateLimitError"].includes(
        error.name,
      )
    )
      logger.error(error);
    throw error;
  } finally {
    if (logging) logger.emit({ _durationMs: performance.now() - started });
  }
}

/** Each consuming host owns the resources opened by its loaders. */
export async function openQueue(queue: QueueDefinition, resources: AsyncDisposableStack) {
  const jobs: Record<string, AnyJob> = Object.create(null);
  for (const [name, job] of Object.entries(queue.jobs)) {
    const handler = "handler" in job ? job.handler : await job.load(resources);
    if (typeof handler !== "function")
      throw new TypeError(`Job '${name}' requires a handler function`);
    jobs[name] = { ...job, handler };
  }
  return { ...queue, jobs };
}
