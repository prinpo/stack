# Optional evlog integration

The design interview is complete and the implementation boundary is confirmed. The [logging guide](../logger.md) documents the public interface and usage.

## Purpose

Make evlog simple to adopt as an optional Stack Block. Applications and services can use Elysia without enabling evlog. Applications that opt in should need little setup while retaining evlog's native functions, options, and types.

## Agreed scope

- Backend request logging and structured errors, with their HTTP behavior and runtime/type behavior verified through Eden and Eden Query.
- A runnable fullstack example demonstrating the integration through Stack's public imports.
- Explicit opt-in setup, simplified by Stack where it removes repeated initialization and integration work.
- One plugin registration on an ordinary Elysia instance should initialize logging and attach the integration.
- Export native evlog utilities through `@prinpo/stack/logger`, the `logger` Elysia integration through `@prinpo/stack/logger/elysia`, and the browser-safe `isStructuredApiError` guard through `@prinpo/stack/logger/client`.
- Provide `apiError` on Elysia's request context through the logger plugin. Expected usage is `.post("/orders", ({ apiError }) => { return apiError(status, fields); })`. The helper declares a native Elysia status-response type while internally throwing a native evlog error, allowing Eden to infer the route's failure branches. The plugin's serializer must honor that declaration.
- Trust the helper's inferred TypeScript error contract in normal usage; add no extra backend response-schema validation pass. Document that explicit conflicting error response schemas and custom error handlers can override that contract. Native request validation and success-response schemas remain usable. Client-side Zod guard validation is still part of the agreed interface.
- Configure one logger instance per application and share it between the main instance and route plugins. Register it on the main instance before routes/modules and locally wherever a route plugin consumes `apiError` for TypeScript visibility. Use native Elysia global scope and deduplication; avoid independently initializing multiple same-name logger instances with different configuration.
- Support thrown evlog errors as a runtime fallback. Route inference still requires an explicit typed failure branch.
- Preserve evlog's `message`, `why`, `fix`, and `link` fields and its optional application-defined `code`. Stack's helper must not require a code.
- Register structured HTTP error handling with the opt-in Elysia plugin. Public responses contain `status`, `message`, and optional `data`; guidance (`why`, `fix`, `link`), optional `code`, and application-defined public fields belong under `data`. Internal context, causes, and stacks remain in logs.
- Include one browser-safe, Zod-backed guard usable inside native Query client-wide error callbacks and endpoint-specific mutation `onError` callbacks. For an unknown client-wide failure it should expose the general validated structure; for an inferred endpoint failure it should preserve the endpoint's specific error fields and data. A new parser or callback abstraction is not the requested client handler; applications use native Query callbacks. `isStructuredApiError` checks the shared response structure, not its provenance. A generic intersection predicate has passed initial probes; transport errors and overlapping error variants still require honest broad types and further narrowing.
- Preserve native Elysia `status(...)` responses when logging is enabled. Keep native validation responses intact and defer validation-error rewriting/customization until application usage establishes the required DX.
- Use a static `errors` configuration map for `NOT_FOUND`, `PARSE`, and `UNKNOWN`, allowing overrides for `message`, optional `code`, `why`, `fix`, `link`, and public `data`. Start without mapping callbacks or HTTP-status overrides; retain native category statuses of 404, 400, and 500. `VALIDATION` is outside this milestone.
- Mapped framework failures have useful default public messages, including "Not found" for 404. Unexpected exceptions default to a generic structured 500 response while retaining original diagnostics in logs. Explicit evlog errors preserve their intentionally chosen public fields, including for status 500.
- Own the ordinary Elysia logging completion lifecycle using evlog's toolkit so events reflect the final HTTP response status, including native responses and SPA fallback. Capture diagnostics before completion and emit once after the response outcome is known. Keep evlog's logger machinery; do not introduce a separate logging framework. Streaming integration, completion, and cancellation handling are deferred.
- Omit the native serialized `name` from the public HTTP body and introduce no replacement technology identifier. The Elysia adapter explicitly selects its public fields rather than automatically exposing `EvlogError.toJSON()`.
- Keep default configuration inline in the single plugin registration; no logging configuration file is required. Applications may extract configuration into a module. Local log-reading commands should work with the configured log directory without relying on configuration discovery.
- Immediate local use without an external service or credentials, using evlog's readable development output and JSON production output.
- Log all requests by default, with native evlog `include` and `exclude` options available. Do not assume an API prefix.
- Persist development events locally by default in `.evlog/logs`, retaining at most five files and rotating at approximately 10 MiB per file, with configurable limits and an option to disable persistence. Production defaults to JSON on stdout with persistence off by default. Use evlog's own capabilities for humans and coding agents to inspect local logs; commands use the configured directory without relying on configuration discovery.
- Include a pinned evlog CLI development dependency in this repository and example commands for recent events, failures, and JSON output. Consuming applications can optionally install the tested CLI version; runtime logging must work without it.

## Intended application usage

```ts
import { logger } from "@prinpo/stack/logger/elysia";
import { Elysia } from "@prinpo/stack/server";

const logging = logger({ service: "orders" });

const orders = new Elysia().use(logging).post("/orders", ({ apiError }) => {
  return apiError(409, {
    message: "Order already confirmed",
    code: "ORDER_ALREADY_CONFIRMED",
    fix: "Open the existing order",
  });
});

const app = new Elysia().use(logging).use(orders);
```

The configured logger is shared by the main instance and route plugins. Register it before routes and mount it on the main instance as well; rely on native Elysia global scope and deduplication. This reuse pattern passed initial runtime and type probes. Browser code imports `isStructuredApiError` from `@prinpo/stack/logger/client` and uses it inside native Query callbacks.

## Type and lifecycle boundaries

Initial scratch probes against Elysia 1.4.30, Eden 1.4.9, and evlog 2.34.0 found three constraints that the final design must address:

- Elysia automatically advertises native validation `type` and `on` fields for schema-bearing routes. Replacing the 422 body without retaining or adapting those fields can make endpoint error types disagree with the response. Validation rewriting is therefore deferred.
- The native evlog Elysia plugin can emit before later error handling changes the final HTTP status. SPA fallback and raw `Response` statuses demonstrated mismatches. The accepted toolkit adapter separates diagnostic capture from completion; complete lifecycle coverage remains implementation work.
- Explicit route response schemas can override helper-inferred error types, while the tested error-handler response path bypasses native response validation. Binding the helper through Elysia context does not restore those checks. Stack trusts the inferred contract and documents this boundary rather than adding a backend validation layer.

Global response schemas are not a neutral workaround: they can also change native `status(...)` responses, which this integration must preserve.

Public toolkit APIs cover ordinary request logging, sampling/filtering, native error accumulation, and final-status completion. The toolkit is upstream's beta custom-integration surface; avoid copying private logger internals. Streaming integration, full stream-lifetime timing, cancellation diagnostics, and streaming client handling are deferred. Leave stream bodies to native Elysia behavior and add no stream interception or completion wrapper in this milestone.

## Deferred

Streaming integration and client handling, validation-error rewriting/customization, external logging services, browser log collection, application error-action helpers, and mutation feedback. The remaining client follow-up is described by [ADR 0006](../adr/0006-keep-mutation-lifecycle-policies-application-owned.md) and the [connector guide](../eden-query.md#deferred-backend-errors-and-mutation-feedback); basic client error identification inside native Query callbacks is now included above.

## Validation

Use the fullstack example to demonstrate the opt-in integration, context helper, native Query callbacks, and local log-reading workflow through Stack's public source imports. Keep plain Elysia usable without the Block.

Verify HTTP behavior and type inference together: precise helper failures and public data, optional codes, generic and endpoint-specific guards, native statuses, unchanged native validation, mapped framework failures, nested plugin registration/deduplication, and final logged statuses. Verify that public bodies exclude internal diagnostics and that SPA navigation/API misses retain their intended behavior. Cover development persistence limits and production output with focused checks.

Run `bunx --bun vp check`, `bunx --bun vp test`, and `bunx --bun vp run example:check`. Keep package builds, distribution checks, production application builds, and automated browser E2E deferred under the source-development milestone. Streaming behavior is outside this milestone's qualification.

## Investigation evidence

Temporary type/runtime probes used Elysia 1.4.30, Eden 1.4.9, evlog 2.34.0, and Zod 4.6.7. They demonstrated the typed throwing helper, nested public-data inference through Eden Query, generic guard intersections, shared plugin deduplication, native-plugin final-status mismatches, and the native validation/response-schema boundaries. These probes established feasibility; implementation is covered by integrated HTTP, Query callback, type, persistence, and serving tests.

Primary references: [evlog Elysia integration](https://www.evlog.dev/integrate/frameworks/elysia), [custom integrations](https://www.evlog.dev/extend/custom-framework), [structured errors](https://www.evlog.dev/learn/structured-errors), [filesystem drain](https://www.evlog.dev/integrate/adapters/self-hosted/fs), [local log reading](https://www.evlog.dev/cli/logs), [Elysia plugin dependencies and scope](https://elysiajs.com/essential/plugin), and [Eden response inference](https://elysiajs.com/eden/treaty/response).

## Decisions

- [Declare structured failures through route return types](../adr/0007-declare-structured-failures-through-route-return-types.md)
- [Complete request logs after the final response](../adr/0008-complete-request-logs-after-the-final-response.md)
