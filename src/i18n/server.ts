import { Elysia } from "elysia";
import {
  getTranslations as getGTTranslations,
  getRequestLocale,
  initializeGT,
  withGT,
} from "gt-node";

import type { I18nConfig } from "./config";
import type { Dictionary, DictionaryLoader, Translate } from "./dictionary";

import { localizedApiError } from "../logger/errors";
import { readI18nConfig } from "./config";

export { getGT, getLocale, getLocaleProperties, msg, withGT } from "gt-node";

type ErrorCodes<Source> = Source extends { errors: infer Errors }
  ? {
      [Code in keyof Errors & string]: Errors[Code] extends { message: string } ? Code : never;
    }[keyof Errors & string]
  : never;

let initialized = false;

export function createI18nServer<const Source extends Dictionary>({
  config: input,
  source,
  loadDictionary,
}: {
  config: I18nConfig;
  source: Source;
  loadDictionary: DictionaryLoader;
}) {
  if (initialized) throw new Error("Configure one i18n server per Bun runtime");
  const { fileLocales, ...config } = readI18nConfig(input);
  initializeGT({
    ...config,
    dictionary: source,
    loadDictionary: (locale) => loadDictionary(locale, fileLocales.get(locale) ?? locale),
    cacheUrl: null,
    runtimeUrl: null,
  });

  initialized = true;

  const getDictionaryTranslations = (locale: string) => withGT(locale, () => getGTTranslations());

  function getTranslations(locale = config.defaultLocale): Promise<Translate<Source>> {
    return getDictionaryTranslations(locale);
  }

  function requestLocale(request: Request) {
    return getRequestLocale({
      headers: { "accept-language": request.headers.get("Accept-Language") ?? undefined },
    });
  }

  function elysia<const Errors extends Record<string, number>>(
    statuses: Errors & Record<Exclude<keyof Errors, ErrorCodes<Source>>, never>,
  ) {
    return new Elysia({ name: "prinpo:i18n" }).derive({ as: "global" }, async ({ request }) => {
      const locale = requestLocale(request);
      const [target, fallback] = await Promise.all([
        getDictionaryTranslations(locale),
        getDictionaryTranslations(config.defaultLocale),
      ]);
      const t: Translate<Source> = target;

      function localizedError<
        const Code extends keyof Errors & string,
        const Data extends Record<string, unknown> | undefined = undefined,
      >(code: Code, data?: Data) {
        const status: Errors[Code] = statuses[code];
        if (typeof status !== "number") throw new Error(`Unknown localized error code: ${code}`);
        return localizedApiError<Errors[Code], Code, Data>(
          status,
          code,
          data,
          locale,
          errorText(fallback, code),
          errorText(target, code),
        );
      }

      return { locale, t, localizedError };
    });
  }

  return { ...config, getTranslations, requestLocale, elysia };
}

function errorText(t: Awaited<ReturnType<typeof getGTTranslations>>, code: string) {
  const fields = t.obj(`errors.${code}`);
  if (
    typeof fields !== "object" ||
    fields === null ||
    !("message" in fields) ||
    typeof fields.message !== "string"
  )
    throw new Error(`Missing source message for localized error ${code}`);

  const { message } = fields;
  return {
    message,
    ...("why" in fields && typeof fields.why === "string" && { why: fields.why }),
    ...("fix" in fields && typeof fields.fix === "string" && { fix: fields.fix }),
    ...("link" in fields && typeof fields.link === "string" && { link: fields.link }),
  };
}
