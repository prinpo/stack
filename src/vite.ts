import type { PluginOption } from "vite";

import { createRouterPluginContext } from "@tanstack/router-plugin/context";
import {
  type Config as RouterConfig,
  tanStackRouterCodeSplitter,
} from "@tanstack/router-plugin/vite";
import react, { type Options as ReactOptions } from "@vitejs/plugin-react";
import { existsSync } from "node:fs";

import { apiPrefix, escapeRegExp } from "./api-prefix";
import { readServerConnection } from "./env/server";
import { varlockVitePlugin } from "./env/vite";
import { routerGenerator } from "./router-generator";

export interface StackOptions {
  /** Omit for a frontend-only app. Paths are forwarded without rewriting. */
  api?: true | { target?: string; prefix?: string; serverEnv?: string };
  router?: Omit<Partial<RouterConfig>, "target">;
  react?: ReactOptions;
}

/** React, file-based routes, and an optional same-origin API connection. */
export function stack(options: StackOptions = {}): PluginOption[] {
  const api = options.api === true ? {} : options.api;
  const prefix = apiPrefix(api?.prefix);
  let target = api?.target;
  const managed = !!api && !target;
  let profile: string | undefined;
  const router = {
    target: "react" as const,
    autoCodeSplitting: true,
    ...options.router,
  };
  const context = createRouterPluginContext();
  return [
    ...(existsSync("env/client") ? [varlockVitePlugin({ profile: () => profile })] : []),
    routerGenerator(router, context),
    tanStackRouterCodeSplitter(router, context),
    react(options.react),
    {
      name: "prinpo:stack",
      async config(config, environment) {
        if (managed && environment.command === "serve") {
          const connection = await readServerConnection({
            root: config.root,
            server: api?.serverEnv,
          });
          profile = connection.profile;
          const host = ["0.0.0.0", "::"].includes(connection.host) ? "127.0.0.1" : connection.host;
          const url = new URL("http://127.0.0.1");
          url.hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
          url.port = String(connection.port);
          target = url.origin;
        }
        return {
          resolve: { dedupe: ["react", "react-dom"] },
          server:
            api && target
              ? {
                  proxy: {
                    [`^${escapeRegExp(prefix)}(?:/|\\?|$)`]: {
                      target,
                      changeOrigin: true,
                    },
                  },
                }
              : undefined,
        };
      },
    },
  ];
}
