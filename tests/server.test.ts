import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import { Elysia, serveApp } from "../src/server.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function application(apiPrefix = "/api", files: Record<string, string> = {}) {
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
  const app = new Elysia()
    .get(`${apiPrefix}/health`, () => ({ ok: true }))
    .use(serveApp({ assets, apiPrefix }));
  await app.modules;
  return app;
}

test("the serving plugin returns the app shell for browser deep links", async () => {
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
  "the serving plugin preserves 404s for %s even when HTML is accepted",
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

test("the serving plugin respects a custom API prefix and preserves API routes", async () => {
  const app = await application("/rpc");
  const response = await app.handle(new Request("http://localhost/rpc/health"));
  expect(await response.json()).toEqual({ ok: true });
  const missing = await app.handle(
    new Request("http://localhost/rpc/missing", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(missing.status).toBe(404);
});

test("the serving plugin serves assets and keeps non-navigation requests as 404s", async () => {
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
  const app = await application("/api", {
    "api/health": "Wrong response",
    "api/missing": "Wrong asset",
  });
  const api = await app.handle(new Request("http://localhost/api/health"));
  expect(await api.json()).toEqual({ ok: true });
  const missing = await app.handle(new Request("http://localhost/api/missing"));
  expect(missing.status).toBe(404);
});

test("the serving plugin keeps assets available above 1024 files", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 1024; index++)
    files[`asset-${index}.js`] = "export const ready = true;";
  const app = await application("/api", files);
  const response = await app.handle(new Request("http://localhost/asset-1023.js"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("export const ready = true;");
});
