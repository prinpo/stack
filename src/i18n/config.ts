export interface I18nConfig {
  defaultLocale: string;
  locales?: readonly string[];
  localeRouting?: boolean;
}

export type LocaleConfig = Omit<ReturnType<typeof readI18nConfig>, "fileLocales">;

export function readI18nConfig(input: unknown) {
  if (typeof input !== "object" || input === null || !("defaultLocale" in input))
    throw new Error("gt.config.json must declare a defaultLocale");

  const fileLocales = new Map<string, string>();
  const defaultLocale = addLocale(input.defaultLocale);
  const locales = "locales" in input ? input.locales : [];
  if (!Array.isArray(locales)) throw new Error("gt.config.json locales must be an array");
  const localeRouting = "localeRouting" in input ? input.localeRouting : false;
  if (typeof localeRouting !== "boolean")
    throw new Error("gt.config.json localeRouting must be a boolean");

  for (const locale of locales) addLocale(locale);
  return {
    defaultLocale,
    locales: [...fileLocales.keys()],
    fileLocales,
    localeRouting,
  };

  function addLocale(value: unknown) {
    if (typeof value !== "string")
      throw new Error(`Invalid locale in gt.config.json: ${String(value)}`);
    let locale: string;
    try {
      locale = new Intl.Locale(value).baseName;
    } catch {
      throw new Error(`Invalid locale in gt.config.json: ${value}`);
    }
    if (!fileLocales.has(locale)) fileLocales.set(locale, value);
    return locale;
  }
}
