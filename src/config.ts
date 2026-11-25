import type { StackConfig } from "./config/schema";

export type { StackConfig } from "./config/schema";

export function defineConfig(config: StackConfig): StackConfig {
  return config;
}
