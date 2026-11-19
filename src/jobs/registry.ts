export type JobOperation = "add" | "run" | "getJob" | "inspect";
export type Dispatcher = (
  queue: string,
  operation: JobOperation,
  job: string | undefined,
  args: unknown[],
) => Promise<unknown>;

const runtimes = new Map<string, Dispatcher>();

export function registerRuntime(name: string, dispatch: Dispatcher) {
  if (runtimes.has(name)) throw new Error(`Jobs runtime '${name}' is already started`);
  runtimes.set(name, dispatch);
}

export function unregisterRuntime(name: string, dispatch: Dispatcher) {
  if (runtimes.get(name) === dispatch) runtimes.delete(name);
}

export async function dispatchJob(
  name: string,
  queue: string,
  operation: JobOperation,
  job: string | undefined,
  args: unknown[],
) {
  const dispatch = runtimes.get(name);
  if (!dispatch) throw new Error(`Jobs runtime '${name}' is not started`);
  return dispatch(queue, operation, job, args);
}
