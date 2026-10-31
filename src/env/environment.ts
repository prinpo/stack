import type { SerializedEnvGraph } from "varlock";

export function injectedEnvironment(): SerializedEnvGraph | undefined {
  return process.env.__VARLOCK_ENV ? JSON.parse(process.env.__VARLOCK_ENV) : undefined;
}

/** Retain genuine overrides without treating previously resolved values as caller input. */
export function originalEnvironment(injected = injectedEnvironment()) {
  const values = { ...process.env };
  if (injected) {
    const overrides = new Set(injected.overrideKeys);
    for (const [key, item] of Object.entries(injected.config)) {
      if (!overrides.has(key) && values[key] === (item.envStr ?? String(item.value)))
        delete values[key];
    }
  }
  delete values.__VARLOCK_ENV;
  return values;
}

export function matchesEnvironment(injected: SerializedEnvGraph, mode: string, profile: string) {
  const previousMode = injected.config.NODE_ENV?.value;
  const previousProfile = injected.config.APP_ENV?.value ?? previousMode;
  return (
    (previousMode === undefined || previousMode === mode) &&
    (previousProfile === undefined || previousProfile === profile)
  );
}
