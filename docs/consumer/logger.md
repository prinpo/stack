---
title: Logging Block and development browser logs
description: Configure evlog request logging, declare typed public API failures, recognize client error envelopes, and use development persistence and browserLog.
type: reference
topics: [logging, evlog, errors, diagnosis, browser-logs]
related:
  title: Related
  links: [cli.md, backend.md, eden-query.md, development.md, auth.md]
---

# Logging Block and development browser logs

The logger Block integrates evlog with Bun/Elysia. Elysia, Eden, and Query remain independently usable; ordinary server imports do not enable logging. Stack owns the compatible evlog version and the separately versioned CLI dependency; importing runtime logging does not load the CLI.

## Public import paths

| Import path                       | Public surface                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@prinpo/stack/logger`            | Native evlog named/default exports, plus `browserLog`                                                                |
| `@prinpo/stack/logger/elysia`     | Stack's `logger(options?: LoggerOptions)` Elysia plugin and `LoggerOptions`                                          |
| `@prinpo/stack/logger/client`     | Browser-safe `isStructuredApiError` and `StructuredApiError`                                                         |
| `@prinpo/stack/browser-log`       | `browserLog(...values: unknown[]): void` without evlog initialization                                                |
| `@prinpo/stack/browser-log/built` | Side-effect built-application guard inserted by Stack builds; ordinary application modules use the helper path above |

Use the Elysia context's `apiError`; it is installed by `logger()` rather than exported as a standalone public helper. Native evlog options/types remain available through the root logging path. See [evlog documentation](https://evlog.dev/) for the native API.

## Configure once

```ts
// logging.ts
import { logger } from "@prinpo/stack/logger/elysia";

export const logging = logger({ service: "orders" });
```

Register that same instance on the **main Elysia instance before its routes/modules**, and locally in every route plugin consuming its context types:

```ts
import { Elysia } from "@prinpo/stack/server";

import { logging } from "./logging";

const orders = new Elysia().use(logging).post("/orders", ({ log, apiError }) => {
  log.set({ order: { id: "order-123" } });
  return apiError(409, {
    message: "Order already confirmed",
    code: "ORDER_CONFIRMED",
    why: "An order can only be confirmed once",
    fix: "Open the existing order",
    data: { orderId: "order-123" },
    internal: { processor: "backend-only" },
  });
});

export const app = new Elysia().use(logging).use(orders);
```

Global scope propagates hooks, and Elysia deduplicates the shared plugin. Local registration supplies module TypeScript visibility. Configure one instance per application: independently constructing same-name plugins with different options reinitializes evlog's process-wide settings.

`logger()` initializes evlog and installs request logging and HTTP error handling. No configuration file or external service is required. `LoggerOptions` extends native `EvlogConfig` with `persistence` and an `errors` map for `NOT_FOUND`, `PARSE`, and `UNKNOWN`. Pass native evlog configuration, including `include`, `exclude`, `routes`, `sampling`, `redact`, `enrich`, `drain`, and `extends`. All requests are logged by default. Context `log` is the native request logger; accumulate fields with `log.set()` instead of emitting a second request event.

Native utilities for scripts, jobs, and immediate logging remain available from `@prinpo/stack/logger`, including `initLogger`, `log`, `createLogger`, `createError`, and `parseError`. This Elysia adapter provides its request logger through context; upstream framework-specific async accessors are not bound to it.

## Return a typed failure

**Return `apiError(status, fields)`** from the route. It advertises a native Elysia status-response return type to Eden while throwing a native evlog error internally. The integration records the error and serializes its public response:

```json
{
  "status": 409,
  "message": "Order already confirmed",
  "data": {
    "orderId": "order-123",
    "code": "ORDER_CONFIRMED",
    "why": "An order can only be confirmed once",
    "fix": "Open the existing order"
  }
}
```

`message` is required; `code`, `why`, `fix`, `link`, and public `data` are optional. Guidance overrides colliding application-data keys, following evlog. Internal context, causes, stacks, and the error name stay out of the HTTP projection. Guidance and `data` are intentionally public.

A bare call still throws but does not declare a failure in a route that returns something else. Services must preserve and return their inferred union to propagate failure types. Ordinary thrown evlog errors also receive structured responses at runtime; arbitrary throws do not become declared route branches.

Stack trusts the inferred contract without another backend validation pass. Elysia's error-handler response path bypasses response validation: conflicting explicit error response schemas or earlier response-producing application handlers can replace the advertised contract. Native request and success-response validation remain available.

## Query callbacks

The same browser-safe guard works inside native global and endpoint-specific callbacks:

```ts
import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { MutationCache } from "@prinpo/stack/query";

const mutationCache = new MutationCache({
  onError(error) {
    if (isStructuredApiError(error)) {
      console.info(error.value.message, error.value.data?.fix);
    }
  },
});

// Given the typed endpoint above:
const options = eden.orders.post.mutationOptions({
  onError(error) {
    if (isStructuredApiError(error) && error.status === 409) {
      console.info(error.value.data.orderId);
    }
  },
});
```

Supply `mutationCache` through native QueryClient options, such as `createApiClient`'s `query` option. Stack introduces no callback framework or presentation policy. The connector still throws Eden's `{ status, value }` error; the Zod guard validates it without changing it. Generic intersections preserve existing endpoint literals and custom fields; unknown global failures narrow only to the shared structure.

This is structural recognition, not proof of evlog provenance. Status 503 alone cannot distinguish server failures from unknown-valued transport failures. Overlapping optional codes require further narrowing. Native `parseError()` does not directly unwrap Eden's envelope; use the guard to access `value`.

## Framework errors and serving

Native returned or thrown `status(...)` responses keep their statuses and bodies. Native validation responses remain intact. Customize other failures with a static map:

```ts
logger({
  service: "orders",
  errors: {
    NOT_FOUND: { message: "Nothing here", code: "MISSING" },
    PARSE: { fix: "Submit valid JSON" },
    UNKNOWN: { message: "Something went wrong" },
  },
});
```

The categories retain HTTP 404, 400, and 500. Unexpected failures use a generic public message while original diagnostics remain in logs. `VALIDATION` rewriting is deferred. Explicit evlog errors are recognized first, so an application code of `NOT_FOUND` remains an application failure.

The toolkit adapter emits one event with the final ordinary HTTP response status. `serveApp` resolves SPA navigation through a fallback route, preserving API/asset misses and application failures. Filtering and sampling affect logging, not the error response contract.

## Local diagnosis

Development uses native readable terminal output and compact files in `.evlog/logs`. Defaults retain five files and rotate at approximately 10 MiB per file. Configure `persistence: { dir, maxFiles, maxSizePerFile }`, or disable it with `persistence: false`. Production (`NODE_ENV=production`) uses native JSON stdout and disables development persistence.

Stack retains the native writer/format and serializes local writes with retention based on modification time. Limits count files, not days; one event can exceed the size threshold.

Inspect persisted events using [CLI log retrieval](cli.md):

```sh
bunx --no-install stack logs errors --json
bunx --no-install stack logs <request-id> --json
```

Use a shared declared `LOG_DIR` for runtime persistence and commands, or set an explicit native `persistence.dir`. An explicit logger directory overrides `LOG_DIR`; the CLI's `--dir` must match when diagnosing those files. A custom `drain` still runs after the development file drain. Runtime logging needs no CLI. Production uses native JSON stdout and the Stack CLI supplies no remote aggregation.

Streaming integration, stream completion/cancellation diagnostics, browser log collection, external services, validation rewriting, and application feedback/actions remain deferred. Stream bodies retain native Elysia handling and are not intercepted.

## Explicit server-to-browser development logs

```ts
import { browserLog } from "@prinpo/stack/browser-log";
// Also exported by @prinpo/stack/logger; no logger initialization is required.
browserLog("Loaded order", { id: order.id });
```

Standard `stack dev` automatically preloads the backend forwarding adapter and enables the receiver through the standard Stack Vite preset. An explicit call writes to the server console and all connected browser consoles, prefixed `[server]` in the browser. Ordinary console methods are unchanged. No tab correlation, plugin option or durable replay is added. Backend-only apps retain server output with no Vite dependency. Standalone source startup retains server output; automatic browser forwarding belongs to the CLI-managed development lifecycle.

Values are inspected into bounded text snapshots for browser forwarding; circular objects and errors do not require JSON-safe app arguments. The browser does not retain live object references. Output is best-effort: disconnected clients miss messages, and restart/reload does not replay history. The function is separate from evlog request fields/drains.

`stack build` inserts an early built-app guard, and production browser builds include no receiver. In built applications the entire function is a no-op, including server output, even if launched directly with `NODE_ENV=development` or an inherited development preload. Normal JavaScript argument evaluation still occurs. Development tooling files can remain installed with Stack without becoming part of the built app's active integration.
