import type { ReactNode } from "react";

import { createBrowserHistory, useRouter } from "@tanstack/react-router";
import { determineLocale } from "generaltranslation";
import {
  GTProvider,
  initializeGTSPA,
  useTranslations as useGTTranslations,
  useLocaleDirection,
} from "gt-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { I18nConfig } from "./config";
import type { Dictionary, DictionaryLoader, Translate } from "./dictionary";

import { readI18nConfig } from "./config";
import { createLocaleRouter } from "./router";

export {
  T,
  Currency,
  DateTime,
  Num,
  Plural,
  RelativeTime,
  Var,
  getLocaleProperties,
  msg,
  useGT,
} from "gt-react";

type Translations = Parameters<typeof GTProvider>[0]["translations"][string];

const preferenceKey = "stack.locale";
let initializedClient: symbol | undefined;

function loadPreference() {
  try {
    return window.localStorage.getItem(preferenceKey);
  } catch {
    return null;
  }
}

function savePreference(locale: string) {
  try {
    window.localStorage.setItem(preferenceKey, locale);
  } catch {
    // Switching remains available when storage is disabled.
  }
}

export function createI18nClient<const Source extends Dictionary>({
  config: input,
  source,
  loadDictionary,
  loadTranslations,
}: {
  config: I18nConfig;
  source: Source;
  loadDictionary: DictionaryLoader;
  loadTranslations?: (locale: string, fileLocale: string) => Promise<Translations>;
}) {
  const { fileLocales, ...config } = readI18nConfig(input);
  const client = Symbol();
  type Selection = { locale: string; dictionary: Dictionary; translations: Translations };
  const catalogs = new Map<string, Promise<Selection>>();
  type LocaleState = { locale: string; setLocale: (locale: string) => Promise<void> };
  const LocaleContext = createContext<LocaleState | null>(null);

  type History = ReturnType<typeof createBrowserHistory>;
  let routing: ReturnType<typeof createLocaleRouter> | undefined;
  let activeLocale: string | undefined;
  let initialization: Promise<void> | undefined;

  function preferredLocale() {
    if (typeof window === "undefined") return config.defaultLocale;
    const saved = loadPreference();
    const preferences = window.navigator.languages ?? [window.navigator.language];
    return (
      determineLocale([...(saved ? [saved] : []), ...preferences], config.locales) ??
      config.defaultLocale
    );
  }

  function getLocale() {
    const path = routing?.location();
    if (path)
      return path.locale ?? (path.pathname === "/" ? preferredLocale() : config.defaultLocale);
    return activeLocale ?? preferredLocale();
  }

  function localePath(pathname: string, locale: string) {
    if (!config.locales.includes(locale)) throw new Error(`Unsupported locale: ${locale}`);
    if (!pathname.startsWith("/") || pathname.startsWith("//"))
      throw new Error("Expected an absolute path within the application");
    return (
      routing?.href(pathname, locale) ??
      (config.localeRouting ? `/${locale}${pathname === "/" ? "" : pathname}` : pathname)
    );
  }

  function routerOptions({
    history = createBrowserHistory(),
    basepath = "/",
  }: {
    history?: History;
    basepath?: string;
  } = {}) {
    if (!config.localeRouting) return { history, basepath, InnerWrap: Provider };
    const adapter = createLocaleRouter(config, history, basepath);
    routing = adapter;
    function RouterI18nProvider({ children }: { children: ReactNode }) {
      const router = useRouter();
      useLayoutEffect(() => {
        adapter.setRouteMatcher((pathname) => Boolean(router.getMatchedRoutes(pathname)[2]));
        return () => adapter.setRouteMatcher();
      }, [router]);
      return <Provider>{children}</Provider>;
    }
    return { history, basepath, rewrite: adapter.rewrite, InnerWrap: RouterI18nProvider };
  }

  async function load(locale: string): Promise<Selection> {
    if (initializedClient && initializedClient !== client)
      throw new Error("Configure one i18n client per browser application");
    initializedClient = client;
    initialization ??= initializeGTSPA({
      ...config,
      locale,
      dictionary: source,
      cacheUrl: null,
      runtimeUrl: null,
    });
    let catalog = catalogs.get(locale);
    if (!catalog) {
      const fileLocale = fileLocales.get(locale) ?? locale;
      catalog = Promise.all([
        Promise.resolve().then(() =>
          locale === config.defaultLocale ? source : loadDictionary(locale, fileLocale),
        ),
        Promise.resolve().then(() => loadTranslations?.(locale, fileLocale) ?? {}),
        initialization,
      ]).then(([dictionary, translations]) => ({ locale, dictionary, translations }));
      catalogs.set(locale, catalog);
      void catalog.catch(() => catalogs.delete(locale));
    }
    return catalog;
  }

  function Provider({ children, pending }: { children: ReactNode; pending?: ReactNode }) {
    const [selection, setSelection] = useState<Selection>();
    const [failure, setFailure] = useState<{ error: unknown }>();
    const request = useRef(0);

    function apply(next: Selection) {
      activeLocale = next.locale;
      setSelection(next);
    }

    useEffect(() => {
      function synchronize() {
        routing?.canonicalize();
        const id = ++request.current;
        const locale = getLocale();
        if (locale === activeLocale && id > 1) return;
        void load(locale).then(
          (next) => {
            if (id === request.current) apply(next);
          },
          (error: unknown) => {
            if (id === request.current) setFailure({ error });
          },
        );
      }
      synchronize();
      const unsubscribe = routing?.history.subscribe(synchronize);
      return () => {
        request.current++;
        unsubscribe?.();
      };
    }, []);

    async function setLocale(locale: string) {
      if (!config.locales.includes(locale)) throw new Error(`Unsupported locale: ${locale}`);
      const id = ++request.current;
      const next = await load(locale);
      if (id !== request.current) return;
      apply(next);
      routing?.switchLocale(locale);
      savePreference(locale);
    }

    if (failure) throw failure.error;
    if (!selection) return <>{pending}</>;
    return (
      <LocaleContext.Provider value={{ locale: selection.locale, setLocale }}>
        <GTProvider
          locale={selection.locale}
          translations={{ [selection.locale]: selection.translations }}
          dictionaries={{ [selection.locale]: selection.dictionary }}
          _reload={({ locale }) => {
            void setLocale(locale).catch(console.error);
          }}
        >
          <DocumentLocale locale={selection.locale} />
          {children}
        </GTProvider>
      </LocaleContext.Provider>
    );
  }

  function useLocaleState() {
    const state = useContext(LocaleContext);
    if (!state) throw new Error("Render translation hooks inside the i18n Provider");
    return state;
  }

  function useLocale() {
    return useLocaleState().locale;
  }

  function useSetLocale() {
    return useLocaleState().setLocale;
  }

  function useTranslations(): Translate<Source> {
    return useGTTranslations();
  }

  return {
    ...config,
    Provider,
    getLocale,
    localePath,
    routerOptions,
    useLocale,
    useSetLocale,
    useTranslations,
  };
}

function DocumentLocale({ locale }: { locale: string }) {
  const direction = useLocaleDirection();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [direction, locale]);
  return null;
}
