import { createI18nServer } from "@prinpo/stack/i18n/server";

import config from "../../gt.config.json";
import source from "./server/en.json";

export const i18n = createI18nServer({
  config,
  source,
  loadDictionary: async (_locale, fileLocale) =>
    (await import(`./server/${fileLocale}.json`)).default,
});
