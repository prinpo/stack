import { treaty } from "@prinpo/stack/client";
import { type DrainContext, createError } from "@prinpo/stack/logger";
import { logger } from "@prinpo/stack/logger/elysia";
import { Elysia, serveApp, t } from "@prinpo/stack/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";

test("the optional logger returns typed structured failures through Eden", async () => {
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        service: "orders",
        silent: true,
        persistence: false,
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .post("/orders", ({ apiError }) =>
      apiError(409, {
        message: "Order already confirmed",
        code: "ORDER_CONFIRMED",
        why: "An order can only be confirmed once",
        fix: "Open the existing order",
        link: "https://example.com/orders",
        data: { orderId: "order-123" },
        internal: { processor: "private" },
        cause: new Error("private cause"),
      }),
    );

  const { data, error } = await treaty(app).orders.post();
  expect(data).toBeNull();
  expect(error).toMatchObject({
    status: 409,
    value: {
      status: 409,
      message: "Order already confirmed",
      data: {
        code: "ORDER_CONFIRMED",
        why: "An order can only be confirmed once",
        fix: "Open the existing order",
        link: "https://example.com/orders",
        orderId: "order-123",
      },
    },
  });
  expect(JSON.stringify(error?.value)).not.toMatch(/private|EvlogError|stack/);
  await vi.waitFor(() => expect(events).toHaveLength(1));
  expect(events[0]?.event).toMatchObject({
    status: 409,
    error: { internal: { processor: "private" } },
  });
});

test("native configuration inheritance and filters leave error responses usable", async () => {
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        extends: { service: "inherited", exclude: ["/filtered"] },
        silent: true,
        persistence: false,
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .get("/filtered", ({ apiError }) => apiError(400, { message: "Filtered logging only" }))
    .get("/fallback", () => {
      throw createError({ status: 409, message: "Native evlog", code: "NOT_FOUND" });
    });
  expect((await app.handle(new Request("http://localhost/filtered"))).status).toBe(400);
  const response = await app.handle(new Request("http://localhost/fallback"));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    status: 409,
    message: "Native evlog",
    data: { code: "NOT_FOUND" },
  });
  await vi.waitFor(() => expect(events).toHaveLength(1));
  expect(events[0]?.event).toMatchObject({ service: "inherited", path: "/fallback" });
});

test("optional codes and empty guidance serialize consistently with the inferred error body", async () => {
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        silent: true,
        persistence: false,
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .get("/minimal", ({ apiError }) => apiError(400, { message: "No code needed" }))
    .get("/empty", ({ apiError }) => apiError(400, { message: "No code yet", code: "" }));
  const api = treaty(app);
  expect((await api.minimal.get()).error?.value).toEqual({
    status: 400,
    message: "No code needed",
  });
  expect((await api.empty.get()).error?.value).toEqual({
    status: 400,
    message: "No code yet",
    data: { code: "" },
  });
  await vi.waitFor(() => expect(events).toHaveLength(2));
});

test("optional public payloads and guidance overrides match their declared possibilities", async () => {
  const events: DrainContext[] = [];
  const optionalPayload: { message: string; code: "TOP"; data?: { orderId: string } } = {
    message: "Optional payload",
    code: "TOP",
  };
  const optionalOverride: { message: string; code?: "TOP"; data: { code: "DATA" } } = {
    message: "Optional override",
    data: { code: "DATA" },
  };
  const app = new Elysia()
    .use(
      logger({
        silent: true,
        persistence: false,
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .get("/payload", ({ apiError }) => apiError(409, optionalPayload))
    .get("/override", ({ apiError }) => apiError(409, optionalOverride));
  const api = treaty(app);
  const payload = (await api.payload.get()).error;
  expect(payload?.value.data).toEqual({ code: "TOP" });
  expect((await api.override.get()).error?.value.data.code).toBe("DATA");
  await vi.waitFor(() => expect(events).toHaveLength(2));
});

test("SPA navigation logs success while API misses and application failures stay errors", async () => {
  const assets = await mkdtemp(join(tmpdir(), "stack-logger-spa-"));
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        silent: true,
        persistence: false,
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .get("/business", ({ apiError }) =>
      apiError(409, { message: "Missing order", code: "NOT_FOUND" }),
    );
  vi.spyOn(app, "listen").mockReturnValue(app);
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await writeFile(join(assets, "index.html"), "<h1>Stack</h1>");
    serveApp(app, { isProduction: true, assets });
    await app.modules;
    const request = (path: string) =>
      app.handle(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }));
    const navigation = await request("/orders/123");
    expect(navigation.status).toBe(200);
    expect(await navigation.text()).toBe("<h1>Stack</h1>");
    expect((await request("/api/missing")).status).toBe(404);
    expect((await request("/missing.js")).status).toBe(404);
    expect((await request("/business")).status).toBe(409);
    await vi.waitFor(() => expect(events).toHaveLength(4));
    expect(events.map(({ event }) => event.status)).toEqual([200, 404, 404, 409]);
    expect(events[0]?.event.error).toBeUndefined();
  } finally {
    output.mockRestore();
    vi.restoreAllMocks();
    await rm(assets, { recursive: true, force: true });
  }
});

test("shared logger plugins emit one event with the final native response status", async () => {
  const events: DrainContext[] = [];
  const logging = logger({
    service: "native",
    silent: true,
    persistence: false,
    drain: (context) => {
      events.push(context);
    },
  });
  const routes = new Elysia()
    .use(logging)
    .get("/denied", () => new Response("Denied", { status: 403 }))
    .get("/set-denied", ({ set }) => {
      set.status = 403;
      return new Response("Denied");
    })
    .get("/named-denied", ({ set }) => {
      set.status = "Forbidden";
      return new Response("Denied");
    })
    .get("/response-wins", ({ set }) => {
      set.status = 409;
      return new Response("Denied", { status: 403 });
    })
    .get("/native", ({ status }) => status(418, { tea: false }))
    .get("/throw-native", ({ status }) => {
      throw status(410, { gone: true });
    });
  const app = new Elysia().use(logging).use(routes);
  for (const [path, status] of [
    ["denied", 403],
    ["set-denied", 403],
    ["named-denied", 403],
    ["response-wins", 403],
    ["native", 418],
    ["throw-native", 410],
  ] as const) {
    expect((await app.handle(new Request(`http://localhost/${path}`))).status).toBe(status);
  }
  await vi.waitFor(() => expect(events).toHaveLength(6));
  expect(events.map(({ event }) => event.status)).toEqual([403, 403, 403, 403, 418, 410]);
});

test("native enrich and drain callbacks receive request headers", async () => {
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        silent: true,
        persistence: false,
        enrich(ctx) {
          ctx.event.client = ctx.headers?.["x-probe"];
        },
        drain(ctx) {
          events.push(ctx);
        },
      }),
    )
    .get("/headers", () => "ok");
  await app.handle(
    new Request("http://localhost/headers", {
      headers: {
        "x-probe": "native-context",
        authorization: "Bearer private-token",
        cookie: "session=private",
        "x-api-key": "private-key",
      },
    }),
  );
  await vi.waitFor(() => expect(events).toHaveLength(1));
  expect(events[0]?.event.client).toBe("native-context");
  expect(events[0]?.headers?.["x-probe"]).toBe("native-context");
  expect(events[0]?.headers).not.toHaveProperty("authorization");
  expect(events[0]?.headers).not.toHaveProperty("cookie");
  expect(events[0]?.headers).not.toHaveProperty("x-api-key");
});

test.each(["string", "object", "circular"])(
  "non-Error rejections retain private diagnostics (%s)",
  async (kind) => {
    const events: DrainContext[] = [];
    const detail = "private diagnostic";
    const failure: { detail: string; self?: unknown } = { detail };
    if (kind === "circular") failure.self = failure;
    const app = new Elysia()
      .use(
        logger({
          silent: true,
          persistence: false,
          drain: (ctx) => {
            events.push(ctx);
          },
        }),
      )
      .get("/broken", () => Promise.reject(kind === "string" ? detail : failure));

    const response = await app.handle(new Request("http://localhost/broken"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: 500, message: "Internal server error" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]?.event).toMatchObject({
      error: { cause: { message: expect.stringContaining(detail) } },
    });
  },
);

test("framework overrides preserve statuses, private causes, and native validation responses", async () => {
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        silent: true,
        persistence: false,
        errors: {
          NOT_FOUND: { message: "Nothing here", code: "MISSING" },
          PARSE: { fix: "Submit JSON" },
          UNKNOWN: { code: "INTERNAL" },
        },
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .post("/input", ({ body }) => body, { body: t.Object({ name: t.String() }) })
    .get("/broken", () => {
      throw new Error("private diagnostic");
    });
  const call = (path: string, init?: RequestInit) =>
    app.handle(new Request(`http://localhost${path}`, init));
  const missing = await call("/missing");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    status: 404,
    message: "Nothing here",
    data: { code: "MISSING" },
  });
  const malformed = await call("/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({
    status: 400,
    message: "Malformed request",
    data: { fix: "Submit JSON" },
  });
  const invalid = await call("/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({ type: "validation", on: "body" });
  const broken = await call("/broken");
  expect(broken.status).toBe(500);
  expect(await broken.json()).toEqual({
    status: 500,
    message: "Internal server error",
    data: { code: "INTERNAL" },
  });
  await vi.waitFor(() => expect(events).toHaveLength(4));
  expect(events[3]?.event).toMatchObject({
    status: 500,
    error: { code: "INTERNAL", cause: { message: "private diagnostic" } },
  });
});
