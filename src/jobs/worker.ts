import { Child, ChildPool, DELAY_TIME_1, type Job, type Processor, Worker } from "bullmq";
import { setTimeout as sleep } from "node:timers/promises";

import { beforeDeadline } from "./deadline";
import { jobsCleanupTimeoutMs } from "./lifecycle";

type PoolOptions = ConstructorParameters<typeof ChildPool>[0];

/** Native pools register children only after initialization. Track bootstrap too. */
class JobsChildPool extends ChildPool {
  private initializing = new Set<Child>();
  private stopped = false;

  constructor(private configuration: PoolOptions) {
    super(configuration);
  }

  override async retain(processFile: string) {
    if (this.stopped) throw new Error("Jobs processor pool is closed");
    const free = this.getFree(processFile).pop();
    if (free) {
      this.retained[free.pid] = free;
      return free;
    }
    const child = new Child(this.configuration.mainFile!, processFile, this.configuration);
    this.initializing.add(child);
    child.on("exit", () => this.remove(child));
    try {
      await child.init();
      if (this.stopped || child.hasProcessExited())
        throw new Error("Jobs processor closed during initialization");
      this.retained[child.pid] = child;
      return child;
    } catch (error) {
      if (child.childProcess || child.worker) await this.kill(child, "SIGKILL");
      throw error;
    } finally {
      this.initializing.delete(child);
    }
  }

  async dispose(deadline: number) {
    await Promise.all(
      this.getAllFree().map(async (child) => {
        const done = Promise.withResolvers<void>();
        const message = (reply: { cmd?: string; error?: string }) => {
          if (reply.cmd === "stack:disposed") {
            if (reply.error) done.reject(new Error(reply.error));
            else done.resolve();
          }
        };
        const exited = () => done.reject(new Error("Processor exited during cleanup"));
        child.on("message", message);
        child.once("exit", exited);
        try {
          await beforeDeadline(
            Promise.all([child.send({ cmd: "stack:dispose" }), done.promise]),
            deadline,
            "processor cleanup",
          );
        } finally {
          child.off("message", message);
          child.off("exit", exited);
        }
      }),
    );
  }

  async terminate() {
    this.stopped = true;
    await Promise.all(
      [...this.initializing, ...Object.values(this.retained), ...this.getAllFree()].map(
        async (child) => {
          // Child.init awaits argument conversion before spawning. Wait for that
          // handle (not processor-module initialization) so it cannot spawn later
          // outside our cleanup. A failed init removes itself from initializing.
          while (!child.childProcess && !child.worker && this.initializing.has(child))
            await new Promise((resolve) => setTimeout(resolve, 0));
          if (child.childProcess || child.worker) await this.kill(child, "SIGKILL");
        },
      ),
    );
  }
}

/** Count whole native attempts, through persistence and special control-flow exits. */
export class JobsWorker extends Worker<unknown, unknown> {
  private attempts = 0;
  private readonly idle = Promise.withResolvers<void>();
  private readonly closeDelay = new AbortController();
  private draining = false;
  private forced = false;
  // BullMQ calls createSandbox from its constructor, before subclass field initialization.
  declare private sandboxPool: JobsChildPool | undefined;

  declare private processorFile: string;

  async preflight() {
    const pool = this.sandboxPool!;
    const child = await pool.retain(this.processorFile);
    pool.release(child);
  }

  override async delay(milliseconds?: number, controller?: Parameters<Worker["delay"]>[1]) {
    if (controller) return super.delay(milliseconds, controller);
    // Native reconnect delays can lack a controller. Cancel those on close too.
    try {
      await sleep(milliseconds || DELAY_TIME_1, undefined, { signal: this.closeDelay.signal });
    } catch (error) {
      if (!this.closeDelay.signal.aborted) throw error;
    }
  }

  override close(force?: boolean) {
    const closing = super.close(force);
    this.closeDelay.abort();
    return closing;
  }

  protected override createSandbox(processor: string | URL | null | Processor<unknown, unknown>) {
    // BullMQ's documented customization seam invokes us after creating its pool.
    // Pool/config access is private in 6.7.6; keep this pinned integration here.
    const pool: unknown = Reflect.get(this, "childPool");
    if (!(pool instanceof ChildPool)) throw new Error("Unsupported BullMQ processor pool");
    const configuration: PoolOptions = Reflect.get(pool, "opts");
    this.sandboxPool = new JobsChildPool(configuration);
    Reflect.set(this, "childPool", this.sandboxPool);
    this.processorFile = String(processor);
    super.createSandbox(processor);
  }

  override async processJob(...args: Parameters<Worker<unknown, unknown>["processJob"]>) {
    // A Redis fetch can already have acquired a lock when pause or close starts.
    // Leave that job for native stalled recovery instead of invoking a late handler.
    if (this.draining) return;
    this.attempts++;
    try {
      return await super.processJob(...args);
    } finally {
      if (--this.attempts === 0 && this.draining) this.idle.resolve();
    }
  }

  protected override callProcessJob(
    job: Job<unknown, unknown>,
    token: string,
    signal?: AbortSignal,
  ) {
    if (this.forced) throw new Error("Jobs runtime is shutting down");
    return super.callProcessJob(job, token, signal);
  }

  async drain() {
    this.draining = true;
    if (!this.attempts) this.idle.resolve();
    await this.pause(true);
    await this.idle.promise;
  }

  async shutdown(force: boolean, deadline: number) {
    try {
      if (force) {
        this.forced = true;
        this.cancelAllJobs("Jobs runtime is shutting down");
        // Stop interrupted attempts from recording a terminal failure.
        await this.getBackend().close(true);
      }
      await this.sandboxPool?.dispose(deadline + jobsCleanupTimeoutMs);
    } catch (error) {
      force = true;
      throw error;
    } finally {
      try {
        if (force) await this.sandboxPool?.terminate();
      } finally {
        await this.close(true);
      }
    }
  }
}

export type ProcessingJob = Pick<
  Job<unknown, unknown>,
  "name" | "data" | "progress" | "updateData" | "updateProgress"
> & { moveToWait(token?: string): Promise<number | void> };
