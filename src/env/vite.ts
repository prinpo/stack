import type { VarlockVitePluginOptions as NativeVarlockVitePluginOptions } from "@varlock/vite-integration";
import type { Plugin } from "vite";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { clientEnvScript } from "./html";
import { readClientEnv } from "./server";

export type VarlockVitePluginOptions = NativeVarlockVitePluginOptions & {
  /** Override the locally resolved client directory; defaults to the native schema root. */
  client?: string;
  /** Share the backend profile when composing the full-stack preset. */
  profile?: string | (() => string | undefined);
};

/** Native Vite integration, with static-only resolution and a public-only client graph. */
export async function varlockVitePlugin({
  client,
  profile,
  ...options
}: VarlockVitePluginOptions = {}): Promise<Plugin[]> {
  const staticOnly = process.env._VARLOCK_STATIC_ONLY;
  const publicOnly = process.env._VARLOCK_PUBLIC_ONLY;
  const loadPath = process.env._VARLOCK_LOAD_PATH;
  const envProfile = process.env._VARLOCK_ENV_PROFILE;
  const selectedClient =
    client ?? (existsSync(resolve("env/client")) ? resolve("env/client") : undefined);
  if (selectedClient) process.env._VARLOCK_LOAD_PATH = resolve(selectedClient);
  process.env._VARLOCK_ENV_PROFILE =
    (typeof profile === "function" ? profile() : profile) ??
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    "development";
  process.env._VARLOCK_STATIC_ONLY = "1";
  process.env._VARLOCK_PUBLIC_ONLY = "1";
  try {
    // Upstream captures its CLI environment and loads configuration on import.
    const native = await import("@varlock/vite-integration");
    const plugins: Plugin[] = native.varlockVitePlugin(options);
    plugins.push({
      name: "prinpo:public-env-html",
      apply: "serve",
      transformIndexHtml: {
        order: "post",
        async handler() {
          const graph = native.getVarlockLoadedEnv();
          if (!graph) throw new Error("Client environment schema has not been loaded");
          const snapshot = await readClientEnv({
            client: client ?? graph.basePath,
            profile:
              (typeof profile === "function" ? profile() : profile) ??
              process.env.APP_ENV ??
              process.env.NODE_ENV ??
              "development",
          });
          return [
            {
              tag: "script",
              children: clientEnvScript(snapshot.clientValues, snapshot.clientKeys),
              injectTo: "head-prepend",
            },
          ];
        },
      },
    });
    return plugins;
  } finally {
    if (loadPath === undefined) delete process.env._VARLOCK_LOAD_PATH;
    else process.env._VARLOCK_LOAD_PATH = loadPath;
    if (envProfile === undefined) delete process.env._VARLOCK_ENV_PROFILE;
    else process.env._VARLOCK_ENV_PROFILE = envProfile;
    if (staticOnly === undefined) delete process.env._VARLOCK_STATIC_ONLY;
    else process.env._VARLOCK_STATIC_ONLY = staticOnly;
    if (publicOnly === undefined) delete process.env._VARLOCK_PUBLIC_ONLY;
    else process.env._VARLOCK_PUBLIC_ONLY = publicOnly;
  }
}
