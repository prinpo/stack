import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  AnyJob,
  JobContext,
  JobDefinition,
  LoadedJobDefinition,
  Phases,
  QueueDefinition,
} from "./types";

function validatePhases(phases: unknown) {
  if (
    phases !== undefined &&
    (!Array.isArray(phases) ||
      !phases.length ||
      phases.some((phase) => typeof phase !== "string" || !phase))
  )
    throw new TypeError("Job phases must be a nonempty list of nonempty strings");
}

export function defineJob<S extends StandardSchemaV1, const P extends Phases, Result>(
  definition: JobDefinition<S, Result, P> & { phases: P },
): JobDefinition<S, Result, P>;
export function defineJob<S extends StandardSchemaV1, Result>(
  definition: JobDefinition<S, Result>,
): JobDefinition<S, Result>;
export function defineJob<S extends StandardSchemaV1, const P extends Phases, Result>(
  definition: LoadedJobDefinition<S, Result, P> & { phases: P },
): LoadedJobDefinition<S, Result, P>;
export function defineJob<S extends StandardSchemaV1, Result>(
  definition: LoadedJobDefinition<S, Result>,
): LoadedJobDefinition<S, Result>;
export function defineJob(definition: AnyJob): AnyJob {
  validatePhases(definition.phases);
  return definition;
}

export function defineQueue<const Name extends string, const Jobs extends Record<string, AnyJob>>(
  name: Name,
  definition: Omit<QueueDefinition<Name, Jobs>, "name">,
): QueueDefinition<Name, Jobs> {
  if (!name || name.includes(":"))
    throw new TypeError("Queue names must be nonempty and cannot contain ':'");
  if (Object.hasOwn(definition.jobs, "then"))
    throw new TypeError("Job name 'then' is reserved for promise interoperability");
  return { ...definition, name };
}

type ContextJob<S extends StandardSchemaV1, Result, P, Context> = Omit<
  JobDefinition<S, Result, P>,
  "handler"
> & {
  handler(
    this: void,
    job: Parameters<JobDefinition<S, Result, P>["handler"]>[0],
    context: Omit<Context, "logger"> & Pick<JobContext<unknown>, "logger">,
    token?: string,
    signal?: AbortSignal,
  ): Result | Promise<Result>;
};

/** Build a family of job definitions sharing resources for the lifetime of a worker or isolate. */
export function defineJobContext<Context extends object>(
  setup: (resources: AsyncDisposableStack) => Context | Promise<Context>,
) {
  const contexts = new WeakMap<AsyncDisposableStack, Promise<Context>>();
  function job<S extends StandardSchemaV1, Result, const P extends Phases>(
    definition: ContextJob<S, Result, P, Context> & { phases: P },
  ): LoadedJobDefinition<S, Result, P>;
  function job<S extends StandardSchemaV1, Result>(
    definition: ContextJob<S, Result, undefined, Context>,
  ): LoadedJobDefinition<S, Result>;
  function job<S extends StandardSchemaV1, Result, P>(
    definition: ContextJob<S, Result, P, Context>,
  ): LoadedJobDefinition<S, Result, P> {
    const { handler, ...contract } = definition;
    validatePhases(contract.phases);
    return {
      ...contract,
      async load(resources) {
        let pending = contexts.get(resources);
        if (!pending) {
          pending = Promise.resolve().then(() => setup(resources));
          contexts.set(resources, pending);
        }
        const context = await pending;
        return (job, token, signal) =>
          handler(job, { ...context, logger: job.logger }, token, signal);
      },
    };
  }
  return job;
}
