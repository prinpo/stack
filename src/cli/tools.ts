import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { type Area, forwardLines, labeledEnvironment } from "./output";

const require = createRequire(import.meta.url);

/** Resolve the installed package's executable, including packages with private manifests. */
export function tool(name: string, executable: string) {
  const resolver = name === "vite-plus" ? createRequire(resolve("package.json")) : require;
  let directory: string;
  try {
    directory = dirname(resolver.resolve(name));
  } catch {
    throw new Error(
      `Missing ${name}. Install the application's development tooling before running this command.`,
    );
  }
  while (true) {
    const path = resolve(directory, "package.json");
    if (existsSync(path)) {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      if (manifest.name === name) {
        const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[executable];
        if (bin) return resolve(directory, bin);
        break;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Installed ${name} has no ${executable} executable.`);
}

export function spawnBun(
  args: string[],
  env: NodeJS.ProcessEnv,
  stdout: "inherit" | "ignore" = "inherit",
  area?: Area,
) {
  const child = spawn(process.execPath, ["--no-env-file", ...args], {
    env: area ? labeledEnvironment(env) : env,
    detached: true,
    stdio: ["inherit", area && stdout === "inherit" ? "pipe" : stdout, area ? "pipe" : "inherit"],
  });
  if (area && child.stdout) forwardLines(child.stdout, process.stdout, area);
  if (area && child.stderr) forwardLines(child.stderr, process.stderr, area, true);
  return child;
}

/** Stop the entire tool group, including watchers and grandchildren. */
export async function stop(child: ChildProcess) {
  if (!child.pid) return;
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  kill("SIGTERM");
  const timeout = setTimeout(() => kill("SIGKILL"), 2000);
  try {
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((done) => child.once("exit", () => done()));
  } finally {
    clearTimeout(timeout);
    kill("SIGKILL");
  }
}

export async function runBun(
  args: string[],
  env: NodeJS.ProcessEnv,
  stdout: "inherit" | "ignore" = "inherit",
  area?: Area,
) {
  const child = spawnBun(args, env, stdout, area);
  const onInterrupt = () => {
    void stop(child);
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  try {
    const status = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => done(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
    if (status !== 0) process.exit(status);
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}
