// BullMQ imports this module inside each child process or worker thread.
import type { SandboxedJob } from "bullmq";

import { parentPort } from "node:worker_threads";

import type { QueueDefinition } from "./types";

import { loadServerEnv } from "../env/server";
import { openQueue, processDefinedJob } from "./processor";

const settings = JSON.parse(process.env._STACK_JOBS_SANDBOX!) as {
  module: string;
  name: string;
  jobs: string[];
  logging: boolean;
};
const resources = new AsyncDisposableStack();
async function initialize() {
  try {
    await loadServerEnv({ client: false });
    const { default: definition } = (await import(settings.module)) as { default: QueueDefinition };
    if (
      definition?.name !== settings.name ||
      JSON.stringify(Object.keys(definition.jobs).sort()) !== JSON.stringify(settings.jobs)
    )
      throw new Error(
        `Expected the default export to define queue '${settings.name}' with jobs ${settings.jobs.join(", ")}`,
      );
    return await openQueue(definition, resources);
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}
const queue = await initialize();

const dispose = async (message: { cmd?: string }) => {
  if (message?.cmd !== "stack:dispose") return;
  try {
    await resources.disposeAsync();
    reply({ cmd: "stack:disposed" });
  } catch (error) {
    reply({ cmd: "stack:disposed", error: String(error) });
  }
};
const reply = (message: object) =>
  parentPort ? parentPort.postMessage(message) : process.send!(message);
if (parentPort) parentPort.on("message", dispose);
else process.on("message", dispose);

export default async function processJob(job: SandboxedJob, token?: string, signal?: AbortSignal) {
  if (typeof job.progress === "string") job.progress = JSON.parse(job.progress);
  return processDefinedJob(queue, job, token, signal, settings.logging);
}
