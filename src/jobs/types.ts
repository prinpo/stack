import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ConnectionOptions, Job, JobsOptions, QueueOptions, WorkerOptions } from "bullmq";

export type Phases = readonly [string, ...string[]];
export type Progress<Phase extends string = string> = { phase: Phase; percent: number };
type PhaseName<P> = P extends readonly string[] ? P[number] : "processing";
export type ProgressUpdate<P> = P extends readonly string[]
  ? Progress<P[number]>
  : { phase?: "processing"; percent: number };

export type JobContext<
  Data,
  P = undefined,
  Result = unknown,
  Name extends string = string,
  Input = Data,
> = Omit<
  Job<Data, Result, Name>,
  "data" | "progress" | "updateData" | "updateProgress" | "returnvalue"
> & {
  readonly data: Data;
  readonly progress: Progress<PhaseName<P> | "processing">;
  readonly returnvalue: Result | null;
  updateData(this: void, input: Input): Promise<void>;
  updateProgress(this: void, progress: ProgressUpdate<P>): Promise<void>;
};

export interface JobDefinition<S extends StandardSchemaV1, Result, P = undefined> {
  readonly input: S;
  readonly phases?: P;
  readonly defaults?: JobsOptions;
  readonly handler: (
    job: JobContext<
      StandardSchemaV1.InferOutput<S>,
      P,
      unknown,
      string,
      StandardSchemaV1.InferInput<S>
    >,
    token?: string,
    signal?: AbortSignal,
  ) => Result | Promise<Result>;
}

/** Erased registry shape; concrete contracts remain inferred at public boundaries. */
export interface AnyJob {
  readonly input: StandardSchemaV1;
  readonly phases?: readonly string[];
  readonly defaults?: JobsOptions;
  readonly handler: (...args: never[]) => unknown;
}
export interface QueueDefinition<
  Name extends string = string,
  Jobs extends Record<string, AnyJob> = Record<string, AnyJob>,
> {
  readonly name: Name;
  readonly jobs: Jobs;
  readonly worker?: Omit<WorkerOptions, "connection" | "prefix" | "autorun">;
  readonly options?: Omit<QueueOptions, "connection" | "prefix">;
  readonly defaultJobOptions?: JobsOptions;
}
export type QueueDefinitions = Record<string, QueueDefinition>;
export type InputOf<D extends AnyJob> = StandardSchemaV1.InferInput<D["input"]>;
export type OutputOf<D extends AnyJob> = StandardSchemaV1.InferOutput<D["input"]>;
export type ResultOf<D extends AnyJob> = Awaited<ReturnType<D["handler"]>>;
type DeclaredPhases<D extends AnyJob> = [Exclude<D["phases"], undefined>] extends [never]
  ? undefined
  : Exclude<D["phases"], undefined>;
export type JobHandle<D extends AnyJob, Name extends string> = JobContext<
  OutputOf<D>,
  DeclaredPhases<D>,
  ResultOf<D>,
  Name,
  InputOf<D>
>;
export interface RunOptions {
  timeoutMs: number;
  job?: JobsOptions;
}
type NamedJobs<Q extends QueueDefinition> = Q["jobs"];
export type QueueJob<Q extends QueueDefinition> = {
  [K in keyof NamedJobs<Q> & string]: JobHandle<NamedJobs<Q>[K], K>;
}[keyof NamedJobs<Q> & string];
export type QueueClient<Q extends QueueDefinition> = {
  getJob: ((id: string) => Promise<QueueJob<Q> | undefined>) & {
    [K in keyof NamedJobs<Q> & string]: (
      id: string,
    ) => Promise<JobHandle<NamedJobs<Q>[K], K> | undefined>;
  };
  add: {
    [K in keyof NamedJobs<Q> & string]: (
      input: InputOf<NamedJobs<Q>[K]>,
      options?: JobsOptions,
    ) => Promise<JobHandle<NamedJobs<Q>[K], K>>;
  };
  run: {
    [K in keyof NamedJobs<Q> & string]: (
      input: InputOf<NamedJobs<Q>[K]>,
      options: RunOptions,
    ) => Promise<ResultOf<NamedJobs<Q>[K]>>;
  };
};
export type JobsClient<Q extends QueueDefinitions> = { [K in keyof Q]: QueueClient<Q[K]> };
export interface JobsOptionsBase {
  name?: string;
  connection: ConnectionOptions;
  prefix?: string;
  startupTimeoutMs?: number;
  enqueueTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onError?: (error: Error) => void;
}

export type CreateJobsOptions<Q extends QueueDefinitions> = JobsOptionsBase & { queues: Q };
