import type { Queue, QueueEvents, QueueEventsListener } from "bullmq";

import { JobsTimeoutError, beforeDeadline } from "./deadline";

export type CancelWait = (error: Error) => void;
type QueueJobEvents = QueueEventsListener<unknown> & {
  [Event in "completed" | "failed" as `${Event}:${string}`]: QueueEventsListener<unknown>[Event];
};

/** Listen for this execution before enqueueing, including auto-removed completions. */
export async function awaitCompletion(
  queue: Queue<unknown, unknown>,
  events: QueueEvents<unknown>,
  id: string,
  submit: () => Promise<unknown>,
  deadline: number,
  pending: Set<CancelWait>,
  signal?: AbortSignal,
) {
  const result = Promise.withResolvers<unknown>();
  const closed = Promise.withResolvers<never>();
  void result.promise.catch(() => {});
  void closed.promise.catch(() => {});
  let settled = false;
  let polling: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;

  const completed = ({ returnvalue }: { returnvalue: unknown }) => {
    settled = true;
    result.resolve(returnvalue);
  };
  const failed = ({ failedReason }: { failedReason: string }) => {
    settled = true;
    result.reject(new JobFailedError(queue.name, id, failedReason));
  };
  const reconcile = async (lastCheck: boolean) => {
    if (settled) return;
    // Read terminal status and result atomically. A Redis failure leaves events and
    // later reconciliation available for the rest of the caller's deadline.
    const outcome = await queue
      .getBackend()
      .isFinished(id, true)
      .catch(() => undefined);
    if (settled) return;
    const [status, value] = (outcome ?? []) as [number?, string?];
    if (status === 1) completed({ returnvalue: value ? JSON.parse(value) : null });
    else if (status === 2) failed({ failedReason: value ?? "Job failed" });
    else if (!lastCheck) scheduleCheck();
  };
  const scheduleCheck = () => {
    // Fast calls do no extra reads. Back off on long waits and give the last
    // lookup time to finish before the deadline even for short waits.
    const untilLastCheck = Math.max(0, deadline - Date.now() - 50);
    const lastCheck = untilLastCheck <= delay;
    polling = setTimeout(
      () => {
        void reconcile(lastCheck).catch(result.reject);
      },
      Math.min(delay, untilLastCheck),
    );
    delay = Math.min(delay * 2, 8000);
  };
  const abort = () => closed.reject(signal?.reason);
  const completedEvent = `completed:${id}` as const;
  const failedEvent = `failed:${id}` as const;
  signal?.addEventListener("abort", abort, { once: true });
  pending.add(closed.reject);
  events.on<QueueJobEvents, typeof completedEvent>(completedEvent, completed);
  events.on<QueueJobEvents, typeof failedEvent>(failedEvent, failed);
  try {
    signal?.throwIfAborted();
    await Promise.race([submit(), closed.promise]);
    if (!settled) scheduleCheck();
    return await beforeDeadline(
      Promise.race([result.promise, closed.promise]),
      deadline,
      "completion",
    );
  } catch (error) {
    if (error instanceof JobsTimeoutError)
      throw new JobsTimeoutError(error.operation, { queueName: queue.name, jobId: id });
    throw error;
  } finally {
    settled = true;
    signal?.removeEventListener("abort", abort);
    clearTimeout(polling);
    pending.delete(closed.reject);
    events.off<QueueJobEvents, typeof completedEvent>(completedEvent, completed);
    events.off<QueueJobEvents, typeof failedEvent>(failedEvent, failed);
  }
}

export class JobFailedError extends Error {
  constructor(
    readonly queueName: string,
    readonly jobId: string,
    readonly failedReason: string,
  ) {
    super(failedReason);
    this.name = "JobFailedError";
  }
}
