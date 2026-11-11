import { resolve } from "node:path";

import { isFile } from "../files";
import { tool } from "./tools";

/** Keep project configuration outside the enforced Vite source root. */
export function frontendArguments(operation: "dev" | "build") {
  const config = ["js", "mjs", "ts", "cjs", "mts", "cts"]
    .map((extension) => `vite.config.${extension}`)
    .find(isFile);
  return [
    tool("vite-plus", "vp"),
    operation,
    resolve("src"),
    "--configLoader",
    "runner",
    ...(config ? ["--config", resolve(config)] : []),
  ];
}

export function frontendEnvironment(env: NodeJS.ProcessEnv) {
  return { ...env, _STACK_VITE_PROJECT_ROOT: process.cwd() };
}
