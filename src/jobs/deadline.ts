export function duration(value: number, name: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647)
    throw new TypeError(
      `${name} must be ${allowZero ? "a nonnegative" : "a positive"} integer no greater than 2147483647`,
    );
  return value;
}

export class JobsTimeoutError extends Error {
  constructor(operation: string) {
    super(`Jobs ${operation} timeout`);
    this.name = "JobsTimeoutError";
  }
}

export async function beforeDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  operation: string,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    void promise.catch(() => {});
    throw new JobsTimeoutError(operation);
  }
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobsTimeoutError(operation)), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
