import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { injectClientEnv } from "./env/html";
import { readClientEnv, readServerConnection } from "./env/server";
import { createSpaHandler, isApiPath } from "./spa";

/** Serve a built SPA with startup-only public configuration, without an Elysia app. */
export async function startFrontend() {
  const config = await readServerConnection();
  const snapshot = await readClientEnv({ profile: config.profile });
  const directory = await realpath(resolve("dist/client"));
  const shell = injectClientEnv(
    await readFile(resolve(directory, "index.html"), "utf8"),
    snapshot.clientValues,
    snapshot.clientKeys,
  );
  const serveShell = createSpaHandler(shell, { cacheControl: "no-store" });
  const notFound = () => new Response("Not Found", { status: 404 });
  const inside = (path: string) => {
    const value = relative(directory, path);
    return value !== ".." && !value.startsWith(`..${sep}`) && !value.startsWith(sep);
  };
  const server = Bun.serve({
    development: false,
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") return notFound();
      let path: string;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response("Invalid URL", { status: 400 });
      }
      if (
        isApiPath(path) ||
        path
          .split("/")
          .some((part) => part === ".git" || part.startsWith(".env") || part === ".DS_Store")
      )
        return notFound();
      const candidate = resolve(directory, `.${path}`);
      if (!inside(candidate)) return notFound();
      if (path !== "/" && path !== "/index.html") {
        try {
          const file = await realpath(candidate);
          if (!inside(file)) return notFound();
          if ((await stat(file)).isFile()) {
            const body = Bun.file(file);
            return new Response(request.method === "HEAD" ? null : body, {
              headers: {
                "Content-Type": body.type,
                "Content-Length": String(body.size),
                "Cache-Control": "no-cache",
              },
            });
          }
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              ["ENOENT", "ENOTDIR"].includes(String(error.code))
            )
          )
            throw error;
        }
      }
      return serveShell(request, path) ?? notFound();
    },
  });
  console.log(`App listening at ${server.url}`);
  return server;
}

if (import.meta.main) await startFrontend();
