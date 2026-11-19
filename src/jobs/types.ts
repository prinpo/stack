import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  ConnectionOptions,
  Job,
  JobsOptions,
  Queue,
  QueueEvents,
  QueueOptions,
  Worker,
  WorkerOptions,
} from "bullmq";
import type { RequestLogger } from "evlog";

import type { JsonResult } from "./serialization";

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
  Pick<
    Job<Data, Result, Name>,
    | "id"
    | "name"
    | "opts"
    | "attemptsMade"
    | "attemptsStarted"
    | "timestamp"
    | "processedOn"
    | "moveToDelayed"
    | "moveToWaitingChildren"
    | "getChildrenValues"
    | "getIgnoredChildrenFailures"
    | "getDependenciesCount"
  >,
  "data" | "progress" | "updateData" | "updateProgress" | "returnvalue"
> & {
  moveToWait(this: void, token?: string): Promise<void>;
  readonly logger: RequestLogger;
  readonly native: Job<Input, Result, Name> | undefined;
  readonly data: Data;
  readonly progress: Progress<PhaseName<P> | "processing">;
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

export type LoadedJobDefinition<S extends StandardSchemaV1, Result, P = undefined> = Omit<
  JobDefinition<S, Result, P>,
  "handler"
> & {
  load(resources: AsyncDisposableStack): Promise<JobDefinition<S, Result, P>["handler"]>;
};

/** Erased registry shape; concrete contracts remain inferred at public boundaries. */
export type AnyJob = {
  readonly input: StandardSchemaV1;
  readonly phases?: readonly string[];
  readonly defaults?: JobsOptions;
} & (
  | { readonly handler: (...args: never[]) => unknown }
  | { load(resources: AsyncDisposableStack): Promise<(...args: never[]) => unknown> }
);
export interface QueueDefinition<
  Name extends string = string,
  Jobs extends Record<string, AnyJob> = Record<string, AnyJob>,
> {
  readonly name: Name;
  readonly jobs: Jobs;
  readonly worker?: WorkerSettings;
  /** URL of the queue module when using an additional process or thread sandbox. */
  readonly module?: string;
  readonly options?: Omit<QueueOptions, "connection" | "prefix">;
}
export type QueueDefinitions = Record<string, QueueDefinition>;
export type InputOf<D extends AnyJob> = StandardSchemaV1.InferInput<D["input"]>;
export type OutputOf<D extends AnyJob> = StandardSchemaV1.InferOutput<D["input"]>;
type HandlerOf<D extends AnyJob> = D extends { handler: infer H }
  ? H
  : D extends { load(resources: AsyncDisposableStack): Promise<infer H> }
    ? H
    : never;
export type ResultOf<D extends AnyJob> = JsonResult<
  Awaited<ReturnType<Extract<HandlerOf<D>, (...args: never[]) => unknown>>>
>;
type DeclaredPhases<D extends AnyJob> = [Exclude<D["phases"], undefined>] extends [never]
  ? undefined
  : Exclude<D["phases"], undefined>;
export type JobHandle<D extends AnyJob, Name extends string> = Omit<
  Job<OutputOf<D>, ResultOf<D>, Name>,
  "data" | "progress" | "updateData" | "updateProgress" | "returnvalue"
> &
  Omit<
    JobContext<OutputOf<D>, DeclaredPhases<D>, ResultOf<D>, Name, InputOf<D>>,
    "logger" | "native" | "moveToWait"
  > & {
    readonly returnvalue: ResultOf<D> | null;
  };
export interface RunOptions {
  timeoutMs: number;
  job?: Omit<JobsOptions, "jobId" | "deduplication"> & { jobId?: never; deduplication?: never };
  /** Abandons this wait; accepted work is not cancelled. */
  signal?: AbortSignal;
}
type NamedJobs<Q extends QueueDefinition> = Q["jobs"];
export type QueueJob<Q extends QueueDefinition> = {
  [K in keyof NamedJobs<Q> & string]: JobHandle<NamedJobs<Q>[K], K>;
}[keyof NamedJobs<Q> & string];
export type JobSnapshot<D extends AnyJob> =
  | { state: "missing" }
  | ({
      id: string;
      data: OutputOf<D>;
      progress: Progress<PhaseName<DeclaredPhases<D>> | "processing">;
    } & (
      | { state: "pending" }
      | { state: "completed"; result: ResultOf<D> }
      | { state: "failed"; reason: string }
    ));

export type QueueClient<Q extends QueueDefinition> = {
  inspect: {
    [K in keyof NamedJobs<Q> & string]: (id: string) => Promise<JobSnapshot<NamedJobs<Q>[K]>>;
  };
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
  /** Return a fresh, queue-safe ID per submission. Defaults to Bun.randomUUIDv7(). */
  generateJobId?: () => string | Promise<string>;
  startupTimeoutMs?: number;
  operationTimeoutMs?: number;
  /** Emit structured lifecycle logs through the configured evlog logger. Defaults to true. */
  logging?: boolean;
  shutdownTimeoutMs?: number;
  onError?: (error: Error) => void;
}

export type WorkerSettings = Omit<
  WorkerOptions,
  | "connection"
  | "prefix"
  | "autorun"
  | "useWorkerThreads"
  | "workerForkOptions"
  | "workerThreadsOptions"
> & {
  sandbox?: "process" | "thread";
};

export type CreateJobsOptions<Q extends QueueDefinitions> = JobsOptionsBase & {
  queues: Q;
};

export interface JobsRuntime<Q extends QueueDefinitions> {
  readonly name: string;
  readonly client: JobsClient<Q>;
  readonly shutdownTimeoutMs: number;
  native(alias: keyof Q & string): {
    queue: Queue<unknown, unknown>;
    worker?: Worker<unknown, unknown>;
    events?: QueueEvents<unknown>;
  };
  start(): Promise<void>;
  close(): Promise<void>;
}
