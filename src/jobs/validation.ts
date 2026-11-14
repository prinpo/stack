import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Job } from "bullmq";

import type { AnyJob } from "./types";

function progressValue(value: unknown, phases: readonly string[] | undefined, reading = false) {
  if (reading && value === 0) return { phase: "processing", percent: 0 };
  if (!value || typeof value !== "object" || !("percent" in value))
    throw new TypeError("Job progress requires a percent value");
  const percent = value.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new TypeError("Job progress percent must be a finite number between 0 and 100");
  const phase = "phase" in value ? value.phase : phases ? undefined : "processing";
  if (
    typeof phase !== "string" ||
    !(
      (reading && phase === "processing") ||
      (phases ? phases.includes(phase) : phase === "processing")
    )
  )
    throw new TypeError("Job progress phase must match the job's declared phases");
  return { phase, percent };
}

export class JobValidationError extends Error {
  constructor(
    readonly issues: ReadonlyArray<StandardSchemaV1.Issue>,
    readonly jobName: string,
  ) {
    super(
      `Job '${jobName}' input validation failed: ${issues.map((issue) => issue.message).join("; ")}`,
    );
    this.name = "JobValidationError";
  }
}

export function serializeInput(input: unknown): unknown {
  const json = JSON.stringify(input);
  if (json === undefined) throw new TypeError("Job input must be JSON-serializable");
  return JSON.parse(json);
}

export async function validateInput(definition: AnyJob, input: unknown, name: string) {
  const result = await definition.input["~standard"].validate(input);
  if (result.issues) throw new JobValidationError(result.issues, name);
  return result.value;
}

/** Keep the transported input in BullMQ; expose the validated view to application code. */
export function jobView(job: Job<unknown, unknown>, definition: AnyJob, data: unknown) {
  let parsed = data;
  return new Proxy(job, {
    get(target, key) {
      if (key === "data") return parsed;
      if (key === "progress") return progressValue(target.progress, definition.phases, true);
      if (key === "updateProgress")
        return async (value: unknown) => {
          await target.updateProgress(progressValue(value, definition.phases));
        };
      if (key === "updateData")
        return async (input: unknown) => {
          const wire = serializeInput(input);
          const next = await validateInput(definition, wire, job.name);
          await target.updateData(wire);
          parsed = next;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
