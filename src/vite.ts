import type { PluginOption } from "vite";

import { createRouterPluginContext } from "@tanstack/router-plugin/context";
import {
  type Config as RouterConfig,
  tanStackRouterCodeSplitter,
} from "@tanstack/router-plugin/vite";
import react, { type Options as ReactOptions } from "@vitejs/plugin-react";
import { resolve } from "node:path";

import { apiPrefix, escapeRegExp } from "./api-prefix";
import { browserLogPlugin } from "./browser-log/vite";
import { readServerConnection } from "./env/server";
import { varlockVitePlugin } from "./env/vite";
import { viteProjectRoot } from "./project-layout";
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
  let projectRoot: string;
  const router = {
    target: "react" as const,
    autoCodeSplitting: true,
    ...options.router,
  };
  const context = createRouterPluginContext();
  return [
    {
      name: "prinpo:source-root",
      enforce: "pre",
      config(config) {
        projectRoot = viteProjectRoot(config.root);
        router.routesDirectory = resolve(
          projectRoot,
          options.router?.routesDirectory ?? "src/routes",
        );
        router.generatedRouteTree = resolve(
          projectRoot,
          options.router?.generatedRouteTree ?? "src/routeTree.gen.ts",
        );
        router.tmpDir = resolve(projectRoot, options.router?.tmpDir ?? ".tanstack/tmp");
        return {
          root: resolve(projectRoot, "src"),
          cacheDir: resolve(projectRoot, config.cacheDir ?? "node_modules/.vite"),
          publicDir:
            config.publicDir === false
              ? false
              : resolve(projectRoot, config.publicDir ?? "src/public"),
          build: {
            outDir: resolve(projectRoot, config.build?.outDir ?? "dist/client"),
            emptyOutDir: true,
          },
        };
      },
    },
    varlockVitePlugin({ profile: () => profile, rootDir: () => projectRoot, optional: true }),
    routerGenerator(router, context),
    tanStackRouterCodeSplitter(router, context),
    react(options.react),
    browserLogPlugin(),
    {
      name: "prinpo:stack",
      async config(_config, environment) {
        if (managed && environment.command === "serve") {
          const connection = await readServerConnection({
            root: projectRoot,
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
