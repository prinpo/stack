import type { LocationRewrite, createBrowserHistory } from "@tanstack/react-router";

import type { LocaleConfig } from "./config";

type History = ReturnType<typeof createBrowserHistory>;

export function createLocaleRouter(config: LocaleConfig, history: History, basepath: string) {
  const base = basepath.replace(/\/$/, "");
  let matchesRoute: ((path: string) => boolean) | undefined;

  function splitLocale(pathname: string) {
    const segment = pathname.split("/")[1];
    const locale = config.locales.find((item) => item.toLowerCase() === segment?.toLowerCase());
    return { locale, pathname: locale ? pathname.slice(segment.length + 1) || "/" : pathname };
  }

  function location() {
    const { pathname, search, hash } = history.location;
    const relative =
      base && (pathname === base || pathname.startsWith(base + "/"))
        ? pathname.slice(base.length) || "/"
        : pathname;
    return { ...splitLocale(relative), search, hash };
  }

  const rewrite: LocationRewrite = {
    input: ({ url }) => {
      url.pathname = splitLocale(url.pathname).pathname;
      return url;
    },
    output: ({ url }) => {
      const current = location();
      if (!current.locale && current.pathname === "/" && url.pathname === "/") return;
      if (matchesRoute && !matchesRoute(url.pathname)) return;
      url.pathname = prefix(url.pathname, current.locale ?? config.defaultLocale);
      return url;
    },
  };

  function href(pathname: string, locale: string) {
    return base + prefix(pathname, locale);
  }

  function switchLocale(locale: string) {
    const { pathname, search, hash } = location();
    const next = href(pathname, locale) + search + hash;
    if (next !== history.location.href) {
      // A locale change stays on the same page and retains its mounted form state.
      history.push(next, history.location.state, { ignoreBlocker: true });
    }
  }

  function canonicalize() {
    const { locale, pathname, search, hash } = location();
    if (locale || pathname === "/" || !matchesRoute?.(pathname)) return;
    const current = history.location.href;
    const next = href(pathname, config.defaultLocale) + search + hash;
    // A history notification may have originated inside the Router.
    queueMicrotask(() => {
      if (history.location.href === current)
        history.replace(next, history.location.state, { ignoreBlocker: true });
    });
  }

  return {
    history,
    href,
    location,
    rewrite,
    switchLocale,
    canonicalize,
    setRouteMatcher: (match?: (pathname: string) => boolean) => {
      matchesRoute = match;
    },
  };
}

function prefix(pathname: string, locale: string) {
  return `/${locale}${pathname === "/" ? "" : pathname}`;
}
