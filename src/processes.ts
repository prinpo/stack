import { type ChildProcess, type StdioOptions, spawn } from "node:child_process";

/** CLI tools and production preparation use the same Bun process-group boundary. */
export function spawnBunProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
  stdio: StdioOptions = "inherit",
) {
  return spawn(process.execPath, ["--no-env-file", ...args], { env, stdio, detached: true });
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

/** Stop the owned group, including descendants, with one bounded escalation. */
export async function stopProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  timeoutMs = 2000,
  signalLeaderFirst = false,
) {
  if (!child.pid) return;
  const cleanedUp = (message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "stack:shutdown-complete"
    )
      signalGroup(child, "SIGKILL");
  };
  child.on("message", cleanedUp);
  if (signalLeaderFirst) child.kill(signal);
  else signalGroup(child, signal);
  const timeout = setTimeout(() => signalGroup(child, "SIGKILL"), timeoutMs);
  try {
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((done) => child.once("exit", () => done()));
  } finally {
    child.off("message", cleanedUp);
    clearTimeout(timeout);
    signalGroup(child, "SIGKILL");
  }
}
