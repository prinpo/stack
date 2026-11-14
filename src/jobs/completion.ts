import type { Job, Queue, QueueEvents } from "bullmq";

import { beforeDeadline } from "./deadline";

export type CancelWait = (error: Error) => void;
type Outcome = { ok: true; value: unknown } | { ok: false; reason: string };

/** Own listeners before enqueueing, including completions removed before add returns. */
export async function awaitCompletion(
  queue: Queue<unknown, unknown>,
  events: QueueEvents<unknown>,
  submit: () => Promise<Job<unknown, unknown>>,
  deadline: number,
  pending: Set<CancelWait>,
) {
  let id: string | undefined;
  const early = new Map<string, Outcome>();
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  let cancel!: CancelWait;
  const result = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const closed = new Promise<never>((_, fail) => {
    cancel = fail;
  });
  // A completion or shutdown can arrive while submission is still resolving.
  void result.catch(() => {});
  void closed.catch(() => {});
  const settle = (outcome: Outcome) => {
    if (outcome.ok) resolve(outcome.value);
    else reject(new Error(outcome.reason));
  };
  const receive = (jobId: string, outcome: Outcome) => {
    if (id === undefined) early.set(jobId, outcome);
    else if (jobId === id) settle(outcome);
  };
  const completed = ({ jobId, returnvalue }: { jobId: string; returnvalue: unknown }) =>
    receive(jobId, { ok: true, value: returnvalue });
  const failed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) =>
    receive(jobId, { ok: false, reason: failedReason });
  pending.add(cancel);
  events.on("completed", completed);
  events.on("failed", failed);
  try {
    const job = await Promise.race([submit(), closed]);
    id = job.id;
    if (!id) throw new Error("Queued job has no ID");
    const cached = early.get(id);
    early.clear();
    if (cached) settle(cached);
    else {
      const stored = await Promise.race([
        beforeDeadline(queue.getJob(id), deadline, "completion lookup"),
        closed,
      ]);
      if (stored) {
        const state = await Promise.race([
          beforeDeadline(stored.getState(), deadline, "completion state"),
          closed,
        ]);
        if (state === "completed") settle({ ok: true, value: stored.returnvalue });
        else if (state === "failed") settle({ ok: false, reason: stored.failedReason });
      }
    }
    return await beforeDeadline(Promise.race([result, closed]), deadline, "completion");
  } finally {
    pending.delete(cancel);
    events.off("completed", completed);
    events.off("failed", failed);
    early.clear();
  }
}
