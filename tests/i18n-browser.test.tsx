// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vite-plus/test";

import { createI18nClient } from "../src/i18n/client";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("switching locale loads the selected dictionary and preserves mounted React state", async () => {
  const i18n = createI18nClient({
    config: { defaultLocale: "en", locales: ["pl", "fr"] },
    source: { heading: "Welcome", help: "Help" },
    loadDictionary: async (locale) => {
      expect(locale).toBe("pl");
      return { heading: "Witaj" };
    },
  });

  function Content() {
    const t = i18n.useTranslations();
    const setLocale = i18n.useSetLocale();
    const [count, setCount] = useState(0);
    return (
      <>
        <h1>{t("heading")}</h1>
        <p>{t("help")}</p>
        <button onClick={() => setCount(count + 1)}>{count}</button>
        <button onClick={() => void setLocale("pl")}>Polski</button>
      </>
    );
  }

  render(
    <i18n.Provider>
      <Content />
    </i18n.Provider>,
  );
  await screen.findByRole("heading", { name: "Welcome" });
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Polski" }));
  });
  await screen.findByRole("heading", { name: "Witaj" });
  expect(screen.getByRole("button", { name: "1" })).toBeTruthy();
  expect(screen.getByText("Help")).toBeTruthy();
});
