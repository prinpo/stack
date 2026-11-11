import type { SerializedEnvGraph } from "varlock";
import type { Plugin } from "vite";

import replace from "@rollup/plugin-replace";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { viteProjectRoot } from "../project-layout";
import { clientEnvScript } from "./html";
import { loadStaticEnv, readClientEnv } from "./server";

export interface VarlockVitePluginOptions {
  /** Client schema path, relative to the Vite root; defaults to env/client or root. */
  client?: string;
  /** Share the backend profile when composing the full-stack preset. */
  profile?: string | (() => string | undefined);
  /** Override the schema search root. */
  rootDir?: string | (() => string);
  /** Skip environment integration when the conventional client schema is absent. */
  optional?: boolean;
}

/** Compile public static settings with Vite; hydrate public dynamics through HTML. */
export async function varlockVitePlugin({
  client,
  profile,
  rootDir,
  optional = false,
}: VarlockVitePluginOptions = {}): Promise<Plugin[]> {
  let clientPath: string;
  let projectRoot: string;
  let graph: SerializedEnvGraph | undefined;
  let replacement: ReturnType<typeof replace>;
  const selectedProfile = () =>
    (typeof profile === "function" ? profile() : profile) ??
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    "development";
  return [
    {
      name: "prinpo:public-env",
      async config(config) {
        projectRoot = resolve(
          (typeof rootDir === "function" ? rootDir() : rootDir) ?? viteProjectRoot(config.root),
        );
        if (optional && !existsSync(resolve(projectRoot, client ?? "env/client"))) return;
        clientPath = client
          ? resolve(projectRoot, client)
          : existsSync(resolve(projectRoot, "env/client"))
            ? resolve(projectRoot, "env/client")
            : projectRoot;
        graph = await loadStaticEnv([clientPath], {
          publicOnly: true,
          profile: selectedProfile(),
          root: projectRoot,
        });
        replacement = replace({
          preventAssignment: true,
          values: Object.fromEntries(
            Object.entries(graph.config)
              .filter(([, item]) => !(item.isDynamic ?? item.isSensitive))
              .map(([key, item]) => [`ENV.${key}`, JSON.stringify(item.value) ?? "undefined"]),
          ),
        });
      },
      transform(code, id) {
        if (!graph) return;
        if (!/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return;
        if (typeof replacement?.transform === "function")
          return replacement.transform.call(this, code, id);
      },
      configResolved(config) {
        if (!graph) return;
        for (const source of graph.sources) {
          if (!source.enabled || !source.path) continue;
          const path = resolve(
            graph.basePath ??
              (statSync(clientPath).isDirectory() ? clientPath : dirname(clientPath)),
            source.path,
          );
          if (existsSync(path) && statSync(path).isFile()) config.configFileDependencies.push(path);
        }
      },
      transformIndexHtml: {
        order: "pre",
        async handler(html, context) {
          if (!graph) return html;
          const schema = graph;
          html = html.replace(/%ENV\.([a-zA-Z_][a-zA-Z0-9._]*)%/g, (_, key: string) => {
            const item = schema.config[key];
            if (!item || item.isSensitive || item.isDynamic)
              throw new Error(`HTML replacement requires a public static config item: ${key}`);
            return String(item.value ?? "");
          });
          if (!context.server) return html;
          const snapshot = await readClientEnv({
            client: clientPath,
            profile: selectedProfile(),
            root: projectRoot,
          });
          return {
            html,
            tags: [
              {
                tag: "script",
                children: clientEnvScript(snapshot.clientValues, snapshot.clientKeys),
                injectTo: "head-prepend",
              },
            ],
          };
        },
      },
    },
  ];
}
