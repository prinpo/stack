import { spawnSync } from "node:child_process";

export function command(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${args.join(" ")} failed: ${result.error ?? result.stdout + result.stderr}`);
  return result.stdout.trim();
}
