# Localize public API errors by code

Applications can return a localized API error by its static code, for example `return localizedError("ORDER_CONFIRMED", { orderId })`. A shared definition assigns the HTTP status to each code, and server-side catalogs supply the localized `message`, `why`, `fix`, and `link`. Callers supply the public `data` for each occurrence. The localized helper preserves the existing public error envelope and typed Eden branches described in [ADR 0007](0007-declare-structured-failures-through-route-return-types.md).

Evlog records the default-locale message so operators can search for the same failure across requests. The public response carries the request-locale text so API callers can display it directly.

The initial helper covers application-declared error codes. Stable codes and localization for Stack's built-in Auth and framework failures are deferred.
