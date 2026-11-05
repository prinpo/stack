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
export async function stopProcessGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (!child.pid) return;
  signalGroup(child, signal);
  const timeout = setTimeout(() => signalGroup(child, "SIGKILL"), 2000);
  try {
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((done) => child.once("exit", () => done()));
  } finally {
    clearTimeout(timeout);
    signalGroup(child, "SIGKILL");
  }
}
