import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { Elysia, serveApp } from "../src/server.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function application(apiPrefix = "/api") {
  const assets = await mkdtemp(join(tmpdir(), "prinpo-assets-"));
  directories.push(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html><h1>Stack application</h1>");
  await writeFile(join(assets, "app.js"), "console.log('Stack');");
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
