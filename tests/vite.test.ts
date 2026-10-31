import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { createServer } from "vite";
import { afterEach, expect, test } from "vite-plus/test";

import { stack } from "../src/vite";

const cleanup: Array<() => Promise<unknown>> = [];

test("Bun's config runner loads Stack's server environment defaults", () => {
  const result = spawnSync(
    "bun",
    [
      "--no-env-file",
      "--eval",
      `import { loadConfigFromFile } from "vite";
const loaded = await loadConfigFromFile(
  { command: "serve", mode: "development" },
  "vite.config.ts", undefined, "silent", undefined, "runner",
);
if (!loaded) throw new Error("Example config was not loaded");
console.log("config loaded");`,
    ],
    { cwd: join(process.cwd(), "examples/fullstack"), encoding: "utf8", timeout: 15_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("config loaded");
});

afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});

async function application() {
  const root = await mkdtemp(join(process.cwd(), ".stack-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src/routes"), { recursive: true });
  await writeFile(
    join(root, "src/routes/__root.tsx"),
    'import { createRootRoute } from "@prinpo/stack/react";\nexport const Route = createRootRoute();\n',
  );
  return root;
}

test.each([
  { prefix: undefined, path: "/api/health?source=example" },
  { prefix: "/rpc/", path: "/rpc/health?source=example" },
])("the Vite preset proxies $path without rewriting it", async ({ prefix, path }) => {
  const backend = createHttpServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ path: request.url }));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => backend.close(() => resolve())));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("Missing backend address");

  const server = await createServer({
    configFile: false,
    root: await application(),
    plugins: [stack({ api: { target: `http://127.0.0.1:${address.port}`, prefix } })],
    server: { host: "127.0.0.1", port: 0 },
  });
  cleanup.push(() => server.close());
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  if (!origin) throw new Error("Missing browser origin");

  const response = await fetch(new URL(path, origin));
  expect(await response.json()).toEqual({ path });
  const unrelated = await fetch(new URL(`${prefix?.replace(/\/+$/, "") ?? "/api"}ary`, origin));
  expect(unrelated.status).toBe(404);
});

test("file route generation preserves imports through Stack", async () => {
  const root = await application();
  const routeFile = join(root, "src/routes/index.tsx");
  await writeFile(
    routeFile,
    'import { createFileRoute } from "@prinpo/stack/react";\nexport const Route = createFileRoute("/")({ component: () => <h1>Hello</h1> });\n',
  );
  const server = await createServer({ configFile: false, root, plugins: [stack()] });
  cleanup.push(() => server.close());

  expect(await readFile(routeFile, "utf8")).not.toContain("@tanstack/react-router");
  expect(await readFile(join(root, "src/routeTree.gen.ts"), "utf8")).toContain("IndexRouteImport");
  expect(server.config.server.proxy).toBeUndefined();
});

test("new file routes are generated at configurable locations during development", async () => {
  const root = await application();
  await rename(join(root, "src/routes"), join(root, "pages"));
  const server = await createServer({
    configFile: false,
    root,
    plugins: [stack({ router: { routesDirectory: "pages", generatedRouteTree: "route-tree.ts" } })],
    server: { host: "127.0.0.1", port: 0 },
  });
  cleanup.push(() => server.close());
  await server.listen();
  const route = join(root, "pages/notes.tsx");
  await expect.poll(() => server.watcher.getWatched()[join(root, "pages")]).toContain("__root.tsx");
  await writeFile(
    route,
    'import { createFileRoute } from "@prinpo/stack/react";\nexport const Route = createFileRoute("/wrong")({ component: () => <h1>Notes</h1> });\n',
  );
  await expect
    .poll(() => readFile(join(root, "route-tree.ts"), "utf8"))
    .toContain("NotesRouteImport");
  expect(await readFile(route, "utf8")).toContain('createFileRoute("/notes")');
  expect(await readFile(route, "utf8")).not.toContain("@tanstack/react-router");
  await rm(route);
  await expect
    .poll(() => readFile(join(root, "route-tree.ts"), "utf8"))
    .not.toContain("NotesRouteImport");
});
