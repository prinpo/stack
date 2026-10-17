import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Elysia, serveApp } from "../src/server.ts";

const directories: string[] = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function application({
  apiPrefix = "/api",
  files = {},
  isProduction = true,
  port,
}: {
  apiPrefix?: string;
  files?: Record<string, string>;
  isProduction?: boolean;
  port?: number;
} = {}) {
  const assets = await mkdtemp(join(tmpdir(), "prinpo-assets-"));
  directories.push(assets);
  for (const [name, content] of Object.entries({
    "index.html": "<!doctype html><h1>Stack application</h1>",
    "app.js": "console.log('Stack');",
    ...files,
  })) {
    await mkdir(dirname(join(assets, name)), { recursive: true });
    await writeFile(join(assets, name), content);
  }
  const app = new Elysia().get(`${apiPrefix}/health`, () => ({ ok: true }));
  // Vitest uses Elysia's Web Standard adapter, which cannot open a listener.
  vi.spyOn(app, "listen").mockReturnValue(app);
  serveApp(app, { assets, apiPrefix, isProduction, port });
  await app.modules;
  return app;
}

test("serveApp returns the app shell for browser deep links in production", async () => {
  const app = await application();
  const response = await app.handle(
    new Request("http://localhost/projects/123", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(await response.text()).toBe("<!doctype html><h1>Stack application</h1>");
});

test.each(["/api", "/api/missing", "/missing.js"])(
  "serveApp preserves 404s for %s even when HTML is accepted",
  async (path) => {
    const app = await application();
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Stack application");
  },
);

test("serveApp respects a custom API prefix and preserves API routes", async () => {
  const app = await application({ apiPrefix: "/rpc" });
  const response = await app.handle(new Request("http://localhost/rpc/health"));
  expect(await response.json()).toEqual({ ok: true });
  const missing = await app.handle(
    new Request("http://localhost/rpc/missing", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(missing.status).toBe(404);
});

test("serveApp serves assets and keeps non-navigation requests as 404s", async () => {
  const app = await application();
  const asset = await app.handle(new Request("http://localhost/app.js"));
  expect(await asset.text()).toBe("console.log('Stack');");
  const missing = await app.handle(
    new Request("http://localhost/projects/123", {
      headers: { Accept: "application/json" },
    }),
  );
  expect(missing.status).toBe(404);
  const mutation = await app.handle(
    new Request("http://localhost/projects/123", {
      method: "POST",
      headers: { Accept: "text/html" },
    }),
  );
  expect(mutation.status).toBe(404);
});

test("browser assets never occupy the reserved API namespace", async () => {
  const app = await application({
    files: {
      "api/health": "Wrong response",
      "api/missing": "Wrong asset",
    },
  });
  const api = await app.handle(new Request("http://localhost/api/health"));
  expect(await api.json()).toEqual({ ok: true });
  const missing = await app.handle(new Request("http://localhost/api/missing"));
  expect(missing.status).toBe(404);
});

test("serveApp keeps assets available above 1024 files", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 1024; index++)
    files[`asset-${index}.js`] = "export const ready = true;";
  const app = await application({ files });
  const response = await app.handle(new Request("http://localhost/asset-1023.js"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("export const ready = true;");
});

test.each([true, false])(
  "serveApp starts the app on the default port with isProduction=%s",
  async (isProduction) => {
    const app = await application({ isProduction });
    expect(app.listen).toHaveBeenCalledExactlyOnceWith(3000);
  },
);

test.each([4321, 0])("serveApp starts the app on the configured port %s", async (port) => {
  const app = await application({ port });
  expect(app.listen).toHaveBeenCalledExactlyOnceWith(port);
});

test("serveApp keeps API routes available without serving browser assets in development", async () => {
  const app = await application({ isProduction: false });
  const api = await app.handle(new Request("http://localhost/api/health"));
  expect(api.status).toBe(200);
  expect(await api.json()).toEqual({ ok: true });

  for (const path of ["/", "/app.js", "/projects/123"]) {
    const response = await app.handle(
      new Request(`http://localhost${path}`, { headers: { Accept: "text/html" } }),
    );
    expect(response.status).toBe(404);
  }
});

test("serveApp starts without a browser build in development", async () => {
  const assets = await mkdtemp(join(tmpdir(), "prinpo-no-assets-"));
  directories.push(assets);
  const app = new Elysia().get("/api/health", () => ({ ok: true }));
  vi.spyOn(app, "listen").mockReturnValue(app);

  serveApp(app, { isProduction: false, assets });
  await app.modules;

  expect(app.listen).toHaveBeenCalledExactlyOnceWith(3000);
  const response = await app.handle(new Request("http://localhost/api/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
