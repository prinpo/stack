import { type AnyElysia, Elysia } from "elysia";
import { getPublicDynamicConfigKeys, getPublicDynamicEnv } from "varlock/env";

type Options<Path extends string> = { keys: readonly string[]; path: Path };

function endpoint<const Path extends string>({ keys, path }: Options<Path>) {
  const declared = new Set(getPublicDynamicConfigKeys());
  for (const key of keys) {
    if (!declared.has(key))
      throw new Error(`Public environment key ${key} is not declared public and dynamic`);
  }
  const values = keys.length ? getPublicDynamicEnv([...keys]) : {};
  return new Elysia({ name: "prinpo:public-env", seed: [path, keys] }).get(path, ({ set }) => {
    set.headers["cache-control"] = "no-store";
    return values;
  });
}

/** Expose an explicit browser subset of the configuration validated at server startup. */
export function publicEnv<const Path extends string>(
  options: Options<Path>,
): ReturnType<typeof endpoint<Path>>;
export function publicEnv(options: {
  keys: readonly string[];
  path?: undefined;
}): ReturnType<typeof endpoint<"/api/public-env">>;
export function publicEnv({
  keys,
  path = "/api/public-env",
}: {
  keys: readonly string[];
  path?: string;
}): AnyElysia {
  return endpoint({ keys, path });
}
