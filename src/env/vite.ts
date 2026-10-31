import type { VarlockVitePluginOptions as NativeVarlockVitePluginOptions } from "@varlock/vite-integration";
import type { Plugin } from "vite";

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
  process.env._VARLOCK_STATIC_ONLY = "1";
  process.env._VARLOCK_PUBLIC_ONLY = "1";
  try {
    // Upstream captures its CLI environment and loads configuration on import.
    const native = await import("@varlock/vite-integration");
    const plugins: Plugin[] = native.varlockVitePlugin(options);
    let mode = "development";
    plugins.push({
      name: "prinpo:public-env-html",
      apply: "serve",
      configResolved(config) {
        mode = config.mode;
      },
      transformIndexHtml: {
        order: "post",
        async handler() {
          const graph = native.getVarlockLoadedEnv();
          if (!graph) throw new Error("Client environment schema has not been loaded");
          const snapshot = await readClientEnv({
            client: client ?? graph.basePath,
            mode: (typeof profile === "function" ? profile() : profile) ?? mode,
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
    if (staticOnly === undefined) delete process.env._VARLOCK_STATIC_ONLY;
    else process.env._VARLOCK_STATIC_ONLY = staticOnly;
    if (publicOnly === undefined) delete process.env._VARLOCK_PUBLIC_ONLY;
    else process.env._VARLOCK_PUBLIC_ONLY = publicOnly;
  }
}
