import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const defaults = createRequire(import.meta.url).resolve("@prinpo/stack/env/defaults");

/** The effective server graph always includes Stack-owned declarations. */
export function serverEnvPaths(options: { server?: string; root?: string } = {}) {
  const path = resolve(options.root ?? process.cwd(), options.server ?? "env/server");
  if (options.server !== undefined && !existsSync(path))
    throw new Error(`Server environment path does not exist: ${path}`);
  return existsSync(path) ? [defaults, path] : [defaults];
}
