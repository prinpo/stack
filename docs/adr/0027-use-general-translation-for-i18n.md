# Use General Translation for i18n

Stack will use General Translation's React and Bun-compatible runtime adapters with application-authored dictionaries and local loading. This gives applications access to GT's native APIs and keeps translation authoring and any automation under application ownership. GT's keyed lookup needs a source dictionary, so the browser carries the default-locale catalog along with any selected target catalog. This accepts the source catalog's transfer cost in exchange for using GT's runtime and lookup behavior.

The application declares `defaultLocale` and target `locales` in root `gt.config.json` and can enable locale prefixes with `localeRouting`. Doctor reads the file offline and reports whether i18n is configured and lists the default and target locales together. The normal development and build workflows use the application's local JSON dictionaries.

Browser dictionaries live in `src/i18n/client/{locale}.json` and server dictionaries in `src/i18n/server/{locale}.json`. An application using only one side supplies dictionaries for that side. Stack's browser and server translation helpers infer message keys from their respective source dictionaries, and Stack exposes native GT APIs for capabilities such as JSX translation and formatting.

Use GT's fallback behavior. An entry missing from the target catalog renders the default-locale text. An ID missing from the source dictionary is a lookup error.
