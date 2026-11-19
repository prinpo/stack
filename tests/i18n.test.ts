import type { DrainContext } from "evlog";

import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import { expect, expectTypeOf, test, vi } from "vite-plus/test";

import { createLocalizedSitemap } from "../src/i18n";
import { createI18nServer } from "../src/i18n/server";
import { logger } from "../src/logger/elysia";

test("API errors expose request-locale guidance and preserve the stable status, code and data", async () => {
  const i18n = createI18nServer({
    config: { defaultLocale: "en", locales: ["pl", "fr"] },
    source: {
      errors: { ORDER_CONFIRMED: { message: "Order already confirmed", fix: "Open the order" } },
    },
    loadDictionary: async (locale) => ({
      errors: {
        ORDER_CONFIRMED: {
          message: locale === "pl" ? "Zamówienie potwierdzone" : "Commande confirmée",
        },
      },
    }),
  });
  expect(() =>
    createI18nServer({
      config: { defaultLocale: "pl" },
      source: { welcome: "Witaj" },
      loadDictionary: async () => ({}),
    }),
  ).toThrow("Configure one i18n server per Bun runtime");
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        persistence: false,
        pretty: false,
        silent: true,
        drain: (event) => {
          events.push(event);
        },
      }),
    )
    .use(i18n.elysia({ ORDER_CONFIRMED: 409 }))
    .get("/orders", ({ localizedError, set }) => {
      set.headers.vary = "Origin";
      return localizedError("ORDER_CONFIRMED", { orderId: "42" });
    });

  const request = (language: string) =>
    app.handle(
      new Request("http://localhost/orders", { headers: { "Accept-Language": language } }),
    );
  const [polish, french] = await Promise.all([
    request("*;q=1, en;q=0, pl-PL;q=0.8"),
    request("fr"),
  ]);

  expect(polish.status).toBe(409);
  expect(polish.headers.get("Content-Language")).toBe("pl");
  expect(polish.headers.get("Vary")).toBe("Origin, Accept-Language");
  expect(await polish.json()).toEqual({
    status: 409,
    message: "Zamówienie potwierdzone",
    data: { code: "ORDER_CONFIRMED", fix: "Open the order", orderId: "42" },
  });
  expect(await french.json()).toMatchObject({ message: "Commande confirmée" });
  await vi.waitFor(() => expect(events).toHaveLength(2));
  expect(events.map(({ event }) => event.error)).toEqual([
    expect.objectContaining({ message: "Order already confirmed" }),
    expect.objectContaining({ message: "Order already confirmed" }),
  ]);

  const endpoint = treaty(app).orders.get;
  type Error = NonNullable<Awaited<ReturnType<typeof endpoint>>["error"]>;
  expectTypeOf<Error["status"]>().toEqualTypeOf<409>();
  expectTypeOf<
    Extract<Error, { status: 409 }>["value"]["data"]["code"]
  >().toEqualTypeOf<"ORDER_CONFIRMED">();
});

test("a localized sitemap lists only declared public pages with reciprocal alternates", () => {
  const sitemap = createLocalizedSitemap("https://example.com", [
    { en: "/en/about?ref=a&b=c", pl: "/pl/about", "x-default": "/" },
  ]);
  expect(sitemap.match(/<loc>/g)).toHaveLength(2);
  expect(sitemap.match(/hreflang="pl"/g)).toHaveLength(2);
  expect(sitemap).toContain("<loc>https://example.com/en/about?ref=a&amp;b=c</loc>");
  expect(sitemap).toContain('hreflang="x-default" href="https://example.com/"');
});
