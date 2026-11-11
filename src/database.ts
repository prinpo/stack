import type { Config } from "drizzle-kit";

export * from "drizzle-orm";

type WithoutOutput<T> = T extends unknown ? Omit<T, "out"> & { out?: never } : never;
export type DatabaseConfig = WithoutOutput<Config>;

/** Native Kit settings with Stack's immutable migration output convention. */
export function defineConfig<T extends DatabaseConfig>(
  config: T,
): Omit<T, "out"> & { readonly out: "./migrations" } {
  const resolved = { ...config, out: "./migrations" as const };
  Object.defineProperty(resolved, "out", { writable: false, configurable: false });
  return resolved;
}
