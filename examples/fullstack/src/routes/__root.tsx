import { TanStackRouterDevtools } from "@prinpo/stack/devtools";
import { getLocaleProperties } from "@prinpo/stack/i18n/react";
import { Link, Outlet, createRootRoute, useLocation } from "@prinpo/stack/react";

import { ApiProvider } from "../client";
import { i18n } from "../i18n/client";

export const Route = createRootRoute({ component: Layout });

function Layout() {
  const t = i18n.useTranslations();
  const locale = i18n.useLocale();
  const setLocale = i18n.useSetLocale();
  const onAbout = useLocation({ select: (location) => location.pathname === "/about" });
  return (
    <ApiProvider>
      <title>
        {onAbout ? `${t("about")} | Prinpo Stack` : "Prinpo Stack · Full-stack example"}
      </title>
      <main>
        <header>
          <p className="eyebrow">PRINPO / STACK</p>
          <h1>Prinpo Stack</h1>
          <p>Bun + Elysia + Eden + TanStack Router + Query</p>
          <nav>
            <Link to="/" activeOptions={{ exact: true }}>
              Environment sandbox
            </Link>
            <Link to="/queries">Queries and mutations</Link>
            <Link to="/auth">Authentication</Link>
            <Link to="/organizations">Organizations</Link>
            <Link to="/about">{t("about")}</Link>
          </nav>
          <label>
            {t("language")}{" "}
            <select
              value={locale}
              onChange={(event) => {
                void setLocale(event.target.value).catch(console.error);
              }}
            >
              {i18n.locales.map((code) => (
                <option key={code} value={code}>
                  {getLocaleProperties(code).nativeName}
                </option>
              ))}
            </select>
          </label>
        </header>
        <Outlet />
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      </main>
    </ApiProvider>
  );
}
