import type { Config, RouterPluginContext } from "@tanstack/router-plugin/vite";
import type { Plugin } from "vite";

import { parse } from "@babel/parser";
import { Generator, type GeneratorEvent, getConfig } from "@tanstack/router-generator";
import * as fs from "node:fs/promises";
import { resolve, sep } from "node:path";

const publicModule = "@prinpo/stack/react";
const nativeModule = "@tanstack/react-router";

/** Translate module specifiers only; strings, comments and module augmentations stay intact. */
function routerImports(source: string, from: string, to: string) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  for (const node of [...ast.program.body].reverse()) {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source?.value === from &&
      node.source.start !== null &&
      node.source.end !== null
    ) {
      source =
        source.slice(0, node.source.start) + JSON.stringify(to) + source.slice(node.source.end);
    }
  }
  return source;
}

/** Keep the native generator, adapting its public filesystem seam for Stack imports. */
export function routerGenerator(options: Partial<Config>, context: RouterPluginContext): Plugin {
  let generator: Generator;
  let routesDirectory: string;
  async function generate(event?: GeneratorEvent) {
    await generator.run(event);
    context.routesByFile = generator.getRoutesByFileMap();
  }

  return {
    name: "prinpo:routes",
    enforce: "pre",
    async configResolved(config) {
      if (options.enableRouteGeneration === false) return;
      generator = new Generator({
        root: config.root,
        config: getConfig(
          {
            ...options,
            target: "react",
            tmpDir: options.tmpDir ?? resolve(config.root, ".tanstack/tmp"),
          },
          config.root,
        ),
        fs: {
          async stat(path) {
            const stat = await fs.stat(path, { bigint: true });
            return {
              mtimeMs: stat.mtimeMs,
              mode: Number(stat.mode),
              uid: Number(stat.uid),
              gid: Number(stat.gid),
            };
          },
          rename: fs.rename,
          chmod: fs.chmod,
          chown: fs.chown,
          async readFile(path) {
            try {
              const handle = await fs.open(path);
              try {
                return {
                  stat: await handle.stat({ bigint: true }),
                  fileContent: routerImports(
                    await handle.readFile("utf8"),
                    publicModule,
                    nativeModule,
                  ),
                };
              } finally {
                await handle.close();
              }
            } catch (error) {
              if (error instanceof Error && "code" in error && error.code === "ENOENT")
                return "file-not-existing";
              throw error;
            }
          },
          async writeFile(path, content) {
            await fs.writeFile(path, routerImports(content, nativeModule, publicModule));
          },
        },
      });
      routesDirectory = resolve(config.root, generator.config.routesDirectory);
      await generate();
    },
    configureServer(server) {
      const events = { add: "create", change: "update", unlink: "delete" } as const;
      const onFile = (event: string, path: string) => {
        if (!generator || !path.startsWith(`${routesDirectory}${sep}`)) return;
        if (event !== "add" && event !== "change" && event !== "unlink") return;
        void generate({ type: events[event], path }).catch((error: unknown) => {
          server.config.logger.error(String(error));
        });
      };
      server.watcher.on("all", onFile);
      if (routesDirectory) server.watcher.add(routesDirectory);
      server.httpServer?.once("close", () => server.watcher.off("all", onFile));
    },
    async watchChange(path, { event }) {
      if (generator) await generate({ path, type: event });
    },
  };
}
