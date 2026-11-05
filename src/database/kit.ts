import { fileURLToPath } from "node:url";

import { spawnBunProcess, stopProcessGroup } from "../processes";
/** Execute the pinned native CLI with one inherited, validated environment snapshot. */
export async function runKit(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawnBunProcess(
    [
      "--preload",
      fileURLToPath(import.meta.resolve("varlock/auto-load")),
      fileURLToPath(new URL("./bin.cjs", import.meta.resolve("drizzle-kit"))),
      ...args,
    ],
    { ...env, _VARLOCK_USE_INJECTED_ENV: "1" },
  );
  let interrupted = 0;
  let stopping: Promise<void> | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted = signal === "SIGINT" ? 130 : 143;
    stopping ??= stopProcessGroup(child, signal);
  };
  const sigint = () => interrupt("SIGINT");
  const sigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  try {
    const status = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => done(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
    if (interrupted || status !== 0) {
      process.exitCode = interrupted || status;
      throw new Error(
        `Database command failed (${interrupted || status}). See Drizzle Kit diagnostics above.`,
      );
    }
  } finally {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
    await stopping;
  }
}
