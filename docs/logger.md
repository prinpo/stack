# Optional logging

The logger Block integrates evlog with Bun/Elysia. Elysia, Eden, and Query remain independently usable; ordinary server imports do not enable logging. Stack pins evlog 2.34.0 and Zod 4.6.7 as regular dependencies. Stack pins the separately versioned evlog CLI 0.11.1 for its isolated CLI commands; importing runtime logging does not load the CLI.

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

`logger()` initializes evlog and installs request logging and HTTP error handling. No configuration file or external service is required. Pass native evlog configuration, including `include`, `exclude`, `routes`, `sampling`, `redact`, `enrich`, `drain`, and `extends`. All requests are logged by default. Context `log` is the native request logger; accumulate fields with `log.set()` instead of emitting a second request event.

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

Evlog 2.34.0's native cleanup can delete the latest event when it reuses a removed rotation suffix. Stack retains the native writer/format and serializes local writes with retention based on modification time. Limits count files, not days; one event can exceed the size threshold.

From the repository root:

```sh
bunx --bun vp run example:logs
bunx --bun vp run example:logs:errors
bunx --bun vp run example:logs:json
```

The example shares `LOG_DIR` between its logger and commands. Installed applications use `stack logs`, `stack logs errors`, or `stack logs <requestId>`, with native filters, `--json`, and `--follow`. One-shot JSON is a native result object; following emits newline-delimited events. Directory precedence is `--dir`, selected-profile LOG_DIR, then `.evlog/logs`. Explicit directories skip environment loading; otherwise only LOG_DIR is resolved, without unrelated credentials. Use `--env staging` to inspect that profile's directory. Runtime logging needs no CLI. Repository scripts disable CLI usage telemetry. The CLI declares Node 22+ support; its Elysia `map`/`init` integration is not supported in this pinned version.

Streaming integration, stream completion/cancellation diagnostics, browser log collection, external services, validation rewriting, and application feedback/actions remain deferred. Stream bodies retain native Elysia handling and are not intercepted.
