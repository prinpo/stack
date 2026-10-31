import { staticPlugin } from "@elysiajs/static";
import { type AnyElysia, Elysia, NotFoundError } from "elysia";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { escapeRegExp, apiPrefix as normalizeApiPrefix } from "./api-prefix";

export interface ServeAppPluginsOptions {
  /** Browser build directory, relative to the server's working directory. */
  assets?: string;
  /** Reserved API namespace. Unknown API paths never return the app shell. */
  apiPrefix?: string;
  /** Prepare the HTML shell once at startup; assets on disk remain unchanged. */
  transformIndexHtml?: (html: string) => string | Promise<string>;
}

/** Serve a built SPA on the same origin as an ordinary Elysia application. */
async function serveAppPlugin({
  assets = "dist",
  apiPrefix = "/api",
  transformIndexHtml,
}: ServeAppPluginsOptions = {}) {
  const prefix = normalizeApiPrefix(apiPrefix);
  const directory = resolve(assets);
  const original = await readFile(resolve(directory, "index.html"), "utf8");
  const shell = transformIndexHtml ? await transformIndexHtml(original) : original;
  return new Elysia({ name: "prinpo:serve-app", seed: [directory, prefix] })
    .use(
      await staticPlugin({
        assets: directory,
        prefix: "",
        alwaysStatic: true,
        // The pinned static plugin skips registration entirely when this limit is exceeded.
        staticLimit: Number.POSITIVE_INFINITY,
        ignorePatterns: [
          ".DS_Store",
          ".git",
          ".env",
          new RegExp(`^${escapeRegExp(resolve(directory, "index.html"))}$`),
          new RegExp(`^${escapeRegExp(resolve(directory, `.${prefix}`))}(?:[/\\\\]|$)`),
        ],
        maxAge: 0,
        directive: "no-cache",
      }),
    )
    .all("/*", ({ request, path }) => {
      if (
        (request.method !== "GET" && request.method !== "HEAD") ||
        path === prefix ||
        path.startsWith(`${prefix}/`) ||
        (path !== "/" &&
          path !== "/index.html" &&
          (!request.headers.get("accept")?.includes("text/html") || /\.[^/]+$/.test(path)))
      )
        throw new NotFoundError();
      return new Response(request.method === "HEAD" ? null : shell, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": transformIndexHtml ? "no-store" : "no-cache",
        },
      });
    });
}

export { serveAppPlugin };

type ServeAppOptions = {
  port?: number;
  isProduction: boolean;
} & ServeAppPluginsOptions;
export function serveApp(
  app: AnyElysia,
  { port = 3000, isProduction, ...serveAppPluginOptions }: ServeAppOptions,
) {
  if (isProduction) {
    app.use(serveAppPlugin(serveAppPluginOptions));
  }

  app.listen(port);
  console.log(`API listening at ${app.server?.url}`);
}
