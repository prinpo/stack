import { injectedEnvironment, matchesEnvironment, originalEnvironment } from "../env/environment";

export const profileArgs = {
  env: {
    type: "string",
    description: "Deployment profile (defaults to APP_ENV or the command's mode)",
  },
} as const;

/** Remove Stack options without reparsing or changing native argument order. */
export function takeOptions(raw: string[], strings: string[], booleans: string[] = []) {
  const values: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "--") {
      rest.push(...raw.slice(i));
      break;
    }
    const [name, ...inline] = arg.replace(/^--/, "").split("=");
    if (arg.startsWith("--") && strings.includes(name)) {
      const value = inline.length ? inline.join("=") : raw[++i];
      if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
      values[name] = value;
    } else if (arg.startsWith("--") && booleans.includes(name)) {
      if (inline.length) throw new Error(`--${name} does not accept a value`);
      values[name] = true;
    } else rest.push(arg);
  }
  return { values, rest };
}

export function environment(profile?: string, mode = process.env.NODE_ENV ?? "development") {
  const selected = profile ?? process.env.APP_ENV ?? mode;
  if (!selected) throw new Error("APP_ENV must name a deployment profile.");
  const snapshot = injectedEnvironment();
  const changed = snapshot && !matchesEnvironment(snapshot, mode, selected);
  const inherited = changed ? originalEnvironment(snapshot) : { ...process.env };
  if (changed) {
    delete inherited._VARLOCK_USE_INJECTED_ENV;
    delete inherited._VARLOCK_USE_FROZEN_ENV;
  }
  return {
    ...inherited,
    NODE_ENV: mode,
    APP_ENV: selected,
    // The native Vite integration invokes Varlock without a profile flag.
    _VARLOCK_ENV_PROFILE: selected,
  };
}
