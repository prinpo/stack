import type { PluginOption } from "vite";

import { createRouterPluginContext } from "@tanstack/router-plugin/context";
import {
  type Config as RouterConfig,
  tanStackRouterCodeSplitter,
} from "@tanstack/router-plugin/vite";
import react, { type Options as ReactOptions } from "@vitejs/plugin-react";

import { apiPrefix, escapeRegExp } from "./api-prefix.ts";
import { routerGenerator } from "./router-generator.ts";

export interface StackOptions {
  /** Omit for a frontend-only app. Paths are forwarded without rewriting. */
  api?: { target: string; prefix?: string };
  router?: Omit<Partial<RouterConfig>, "target">;
  react?: ReactOptions;
}

/** React, file-based routes, and an optional same-origin API connection. */
export function stack(options: StackOptions = {}): PluginOption[] {
  const prefix = apiPrefix(options.api?.prefix);
  const router = {
    target: "react" as const,
    autoCodeSplitting: true,
    ...options.router,
  };
  const context = createRouterPluginContext();
  return [
    routerGenerator(router, context),
    tanStackRouterCodeSplitter(router, context),
    react(options.react),
    {
      name: "prinpo:stack",
      config() {
        return {
          resolve: { dedupe: ["react", "react-dom"] },
          server: options.api
            ? {
                proxy: {
                  [`^${escapeRegExp(prefix)}(?:/|\\?|$)`]: {
                    target: options.api.target,
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
