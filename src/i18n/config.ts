export interface I18nConfig {
  defaultLocale: string;
  locales?: readonly string[];
  localeRouting?: boolean;
}

export type LocaleConfig = ReturnType<typeof readI18nConfig>;

export function readI18nConfig(input: unknown) {
  if (typeof input !== "object" || input === null || !("defaultLocale" in input))
    throw new Error("gt.config.json must declare a defaultLocale");

  const defaultLocale = localeTag(input.defaultLocale);
  const locales = "locales" in input ? input.locales : [];
  if (!Array.isArray(locales)) throw new Error("gt.config.json locales must be an array");
  const localeRouting = "localeRouting" in input ? input.localeRouting : false;
  if (typeof localeRouting !== "boolean")
    throw new Error("gt.config.json localeRouting must be a boolean");

  return {
    defaultLocale,
    locales: [...new Set([defaultLocale, ...locales.map(localeTag)])],
    localeRouting,
  };
}

function localeTag(value: unknown) {
  if (typeof value === "string") {
    try {
      return new Intl.Locale(value).baseName;
    } catch {
      // Report the invalid project setting below.
    }
  }
  throw new Error(`Invalid locale in gt.config.json: ${String(value)}`);
}
