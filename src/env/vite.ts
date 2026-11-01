import type { SerializedEnvGraph } from "varlock";
import type { Plugin } from "vite";

import replace from "@rollup/plugin-replace";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { clientEnvScript } from "./html";
import { loadStaticEnv, readClientEnv } from "./server";

export interface VarlockVitePluginOptions {
  /** Client schema path, relative to the Vite root; defaults to env/client or root. */
  client?: string;
  /** Share the backend profile when composing the full-stack preset. */
  profile?: string | (() => string | undefined);
  /** Override the schema search root. */
  rootDir?: string;
}

/** Compile public static settings with Vite; hydrate public dynamics through HTML. */
export async function varlockVitePlugin({
  client,
  profile,
  rootDir,
}: VarlockVitePluginOptions = {}): Promise<Plugin[]> {
  let clientPath: string;
  let graph: SerializedEnvGraph;
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
        const root = resolve(rootDir ?? config.root ?? process.cwd());
        clientPath = client
          ? resolve(root, client)
          : existsSync(resolve(root, "env/client"))
            ? resolve(root, "env/client")
            : root;
        graph = await loadStaticEnv([clientPath], { publicOnly: true, profile: selectedProfile() });
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
        if (!/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return;
        if (typeof replacement.transform === "function")
          return replacement.transform.call(this, code, id);
      },
      configResolved(config) {
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
          html = html.replace(/%ENV\.([a-zA-Z_][a-zA-Z0-9._]*)%/g, (_, key: string) => {
            const item = graph.config[key];
            if (!item || item.isSensitive || item.isDynamic)
              throw new Error(`HTML replacement requires a public static config item: ${key}`);
            return String(item.value ?? "");
          });
          if (!context.server) return html;
          const snapshot = await readClientEnv({ client: clientPath, profile: selectedProfile() });
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
