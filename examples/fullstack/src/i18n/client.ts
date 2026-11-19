import type { Dictionary } from "@prinpo/stack/i18n";

import { createI18nClient } from "@prinpo/stack/i18n/react";

import config from "../../gt.config.json";
import source from "./client/en.json";

const catalogs = import.meta.glob<Dictionary>("./client/*.json", { import: "default" });
export const i18n = createI18nClient({
  config,
  source,
  loadDictionary: (locale) => catalogs[`./client/${locale}.json`]?.() ?? Promise.resolve({}),
});
