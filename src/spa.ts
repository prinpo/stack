import { apiPrefix as normalizeApiPrefix } from "./api-prefix";

export function isApiPath(path: string, prefix = "/api") {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Prepare shared SPA navigation policy and shell headers once, independently of the server. */
export function createSpaHandler(
  shell: string,
  {
    apiPrefix = "/api",
    cacheControl = "no-cache",
  }: { apiPrefix?: string; cacheControl?: string } = {},
) {
  const prefix = normalizeApiPrefix(apiPrefix);
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(shell)),
    "Cache-Control": cacheControl,
  };
  return (request: Request, path: string) => {
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      isApiPath(path, prefix) ||
      (path !== "/" &&
        path !== "/index.html" &&
        (!request.headers.get("accept")?.includes("text/html") || /\.[^/]+$/.test(path)))
    )
      return undefined;
    return new Response(request.method === "HEAD" ? null : shell, { headers });
  };
}
