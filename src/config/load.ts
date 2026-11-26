import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type StackConfig, parseStackConfig } from "./schema";

export async function readStackConfig(): Promise<{ source: string; config: StackConfig }> {
  const source = "stack.config.ts";
  const file = resolve(source);
  if (!existsSync(file)) return { source: "defaults", config: {} };

  let value: unknown;
  try {
    ({ default: value } = await import(pathToFileURL(file).href));
  } catch (error) {
    throw new Error(`Could not load ${source}: ${String(error)}`, { cause: error });
  }
  return { source, config: parseStackConfig(value, source) };
}
