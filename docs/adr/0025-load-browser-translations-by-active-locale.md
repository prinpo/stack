# Load browser translations by active locale

The optional i18n Block supports Stack’s browser and backend independently, using one application-owned locale configuration that Doctor can inspect offline. Applications supply their own translations. The browser carries the default-locale catalog required by [General Translation](0027-use-general-translation-for-i18n.md) and loads a target catalog on demand for the initial locale or a language switch. A catalog can contain all browser messages for its locale, so applications can start without organizing translations by route.

Locale-prefixed paths such as `/pl/settings` are an opt-in mode alongside locale-neutral paths. In prefix mode, every locale has a prefix, including the default, and the URL determines the active locale. The bare root can offer visible language links and suggest a locale based on browser preferences. An existing unprefixed deep link such as `/settings` resolves to the default-locale path, such as `/en/settings`. Unsupported locale prefixes show the router's 404. In locale-neutral mode, a saved choice takes precedence over browser preferences, followed by the app default.

The language switcher loads the target dictionary before applying the change and saves the explicit choice after the switch succeeds. Stack updates the GT provider in place to preserve mounted React state. In prefix mode, it changes the locale segment while preserving the page, query, and fragment.

The initial release uses the existing client-rendered TanStack Router SPA. Public localized pages can use route metadata and declare their alternate URLs in a multilingual sitemap.

The Stack API client sends the active locale in `Accept-Language` so the API uses the same locale as the current page. The backend resolves the header against the supported locales for each request and uses the app default when no preference matches. Direct API callers use the same header.
