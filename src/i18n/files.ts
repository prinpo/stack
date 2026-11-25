import { readFileSync } from "node:fs";

import { isFile } from "../files";
import { readI18nConfig } from "./config";

const configPath = "gt.config.json";

export function inspectI18n() {
  if (!isFile(configPath))
    return { enabled: false, ready: true, locales: [], reason: `Missing ${configPath}` };

  try {
    const { defaultLocale, locales, localeRouting } = readI18nConfig(
      JSON.parse(readFileSync(configPath, "utf8")),
    );
    return {
      enabled: true,
      ready: true,
      defaultLocale,
      locales,
      localeRouting,
      reason: `Found ${configPath}`,
    };
  } catch (error) {
    return {
      enabled: true,
      ready: false,
      locales: [],
      reason: `Invalid ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
