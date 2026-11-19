// @vitest-environment happy-dom
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vite-plus/test";

import { createI18nClient } from "../src/i18n/client";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("prefix mode canonicalizes legacy links and switches the URL without remounting", async () => {
  const history = createMemoryHistory({ initialEntries: ["/app/settings?tab=account#details"] });
  const i18n = createI18nClient({
    config: { defaultLocale: "en", locales: ["pl"], localeRouting: true },
    source: { heading: "Settings" },
    loadDictionary: async () => ({ heading: "Ustawienia" }),
  });
  const root = createRootRoute({ notFoundComponent: () => <p>No matching page</p> });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component() {
      const t = i18n.useTranslations();
      const setLocale = i18n.useSetLocale();
      const [count, setCount] = useState(0);
      return (
        <>
          <h1>{t("heading")}</h1>
          <button onClick={() => setCount(count + 1)}>{count}</button>
          <button onClick={() => void setLocale("pl")}>Polski</button>
        </>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([settings]),
    ...i18n.routerOptions({ history, basepath: "/app" }),
  });
  expect(i18n.localePath("/settings", "pl")).toBe("/app/pl/settings");
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Settings" });
  expect(history.location.href).toBe("/app/en/settings?tab=account#details");
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Polski" }));
  });
  await screen.findByRole("heading", { name: "Ustawienia" });
  expect(history.location.href).toBe("/app/pl/settings?tab=account#details");
  expect(screen.getByRole("button", { name: "1" })).toBeTruthy();

  await act(async () => history.back());
  await screen.findByRole("heading", { name: "Settings" });
  expect(history.location.href).toBe("/app/en/settings?tab=account#details");

  await act(async () => history.push("/app/pl/settings"));
  await screen.findByRole("heading", { name: "Ustawienia" });
  await act(async () => history.push("/app/settings"));
  await screen.findByRole("heading", { name: "Settings" });
  expect(history.location.href).toBe("/app/en/settings");

  await act(async () => history.push("/app/de/settings"));
  await screen.findByText("No matching page");
  expect(history.location.href).toBe("/app/de/settings");
});
