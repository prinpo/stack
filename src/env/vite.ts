import type { VarlockVitePluginOptions } from "@varlock/vite-integration";
import type { Plugin } from "vite";

export type { VarlockVitePluginOptions } from "@varlock/vite-integration";

/** Native Vite integration, with static-only resolution and a public-only client graph. */
export async function varlockVitePlugin(options?: VarlockVitePluginOptions): Promise<Plugin[]> {
  const staticOnly = process.env._VARLOCK_STATIC_ONLY;
  const publicOnly = process.env._VARLOCK_PUBLIC_ONLY;
  process.env._VARLOCK_STATIC_ONLY = "1";
  process.env._VARLOCK_PUBLIC_ONLY = "1";
  try {
    // Upstream captures its CLI environment and loads configuration on import.
    const native = await import("@varlock/vite-integration");
    const plugins: Plugin[] = native.varlockVitePlugin(options);
    return plugins;
  } finally {
    if (staticOnly === undefined) delete process.env._VARLOCK_STATIC_ONLY;
    else process.env._VARLOCK_STATIC_ONLY = staticOnly;
    if (publicOnly === undefined) delete process.env._VARLOCK_PUBLIC_ONLY;
    else process.env._VARLOCK_PUBLIC_ONLY = publicOnly;
  }
}
