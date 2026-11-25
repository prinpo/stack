import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { delimiter, dirname, join } from "node:path";

import type { StackConfig } from "../config/schema";

import { stop } from "./tools";

function packageScripts(): Record<string, unknown> {
  if (!existsSync("package.json")) return {};
  try {
    return JSON.parse(readFileSync("package.json", "utf8"))?.scripts ?? {};
  } catch (error) {
    throw new Error(`Could not read scripts from package.json: ${String(error)}`, { cause: error });
  }
}

function findScript(scripts: Record<string, unknown>, name: string) {
  const command = scripts[name];
  return Object.hasOwn(scripts, name) && typeof command === "string" ? command : undefined;
}

export function inspectLifecycleScripts(config: StackConfig) {
  const registered = Object.entries(config.scripts ?? {}).flatMap(([command, scripts]) =>
    Object.entries(scripts ?? {}).flatMap(([phase, name]) =>
      typeof name === "string" ? [{ command, phase, name }] : [],
    ),
  );
  if (!registered.length) return [];
  const scripts = packageScripts();
  return registered.map((script) => ({
    ...script,
    ready: findScript(scripts, script.name) !== undefined,
  }));
}

function scriptEnvironment(env: NodeJS.ProcessEnv, name: string, command: string) {
  const cwd = process.cwd();
  const paths = [];
  for (let directory = cwd; ; directory = dirname(directory)) {
    paths.push(join(directory, "node_modules", ".bin"));
    if (directory === dirname(directory)) break;
  }
  paths.push(env.PATH ?? "/usr/bin:/bin");
  return {
    ...env,
    PATH: paths.join(delimiter),
    PWD: cwd,
    npm_package_json: join(cwd, "package.json"),
    npm_lifecycle_event: name,
    npm_lifecycle_script: command,
  };
}

export async function runLifecycleScript(
  name: string | undefined,
  phase: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<number> {
  if (!name) return 0;
  if (signal?.aborted) return Number(signal.reason);
  const label = `${phase} script ${JSON.stringify(name)}`;
  try {
    const command = findScript(packageScripts(), name);
    if (command === undefined) throw new Error("Missing from package.json scripts");
    // Run exactly the registered command. Bun run would invoke its implicit pre/post companions.
    const child = spawn("/bin/sh", ["-c", command], {
      detached: true,
      env: scriptEnvironment(env, name, command),
      stdio: "inherit",
    });
    const exited = new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("close", (code, cause) =>
        done(code ?? (cause ? 128 + constants.signals[cause] : 1)),
      );
    });
    let interrupted: number | undefined;
    let stopping: Promise<void> | undefined;
    const cancel = (status: number, cause: NodeJS.Signals) => {
      interrupted ??= status;
      stopping ??= stop(child, cause).catch((error) => console.error(`${label}: ${error}`));
    };
    const interrupt = () => cancel(130, "SIGINT");
    const terminate = () => cancel(143, "SIGTERM");
    const abort = () =>
      cancel(Number(signal?.reason), signal?.reason === 130 ? "SIGINT" : "SIGTERM");
    if (signal) signal.addEventListener("abort", abort, { once: true });
    else {
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
    }
    try {
      const status = await exited;
      await stopping;
      if (interrupted !== undefined) return interrupted;
      if (status) console.error(`${label} failed with exit status ${status}.`);
      return status;
    } finally {
      signal?.removeEventListener("abort", abort);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  } catch (error) {
    console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
