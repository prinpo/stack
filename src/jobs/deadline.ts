export function duration(value: number, name: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647)
    throw new TypeError(
      `${name} must be ${allowZero ? "a nonnegative" : "a positive"} integer no greater than 2147483647`,
    );
  return value;
}

export class JobsTimeoutError extends Error {
  constructor(
    readonly operation: string,
    readonly context?: { queueName: string; jobId?: string },
  ) {
    super(`Jobs ${operation} timeout`);
    this.name = "JobsTimeoutError";
  }
}

export async function beforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  operation: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    void promise.catch(() => {});
    signal.throwIfAborted();
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    void promise.catch(() => {});
    throw new JobsTimeoutError(operation);
  }
  let timer: ReturnType<typeof setTimeout>;
  let aborted: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobsTimeoutError(operation)), remaining);
        aborted = () =>
          reject(
            signal?.reason instanceof Error
              ? signal.reason
              : new Error("Job wait aborted", { cause: signal?.reason }),
          );
        signal?.addEventListener("abort", aborted, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer!);
    if (aborted) signal?.removeEventListener("abort", aborted);
  }
}
