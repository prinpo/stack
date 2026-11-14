import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { AnyJob, JobDefinition, Phases, QueueDefinition } from "./types";

export function defineJob<S extends StandardSchemaV1, const P extends Phases, Result>(
  definition: JobDefinition<S, Result, P> & { phases: P },
): JobDefinition<S, Result, P>;
export function defineJob<S extends StandardSchemaV1, Result>(
  definition: JobDefinition<S, Result>,
): JobDefinition<S, Result>;
export function defineJob(definition: AnyJob): AnyJob {
  if (
    definition.phases &&
    (!definition.phases.length ||
      definition.phases.some((phase) => typeof phase !== "string" || !phase))
  )
    throw new TypeError("Job phases must be a nonempty list of nonempty strings");
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
