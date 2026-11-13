---
title: Typed API queries and mutations
description: Connect Elysia's inferred API to TanStack Query through Stack's Eden client factory, options proxies, cache keys, filters, and React contexts.
type: reference
topics:
  - query
  - eden
  - api-client
  - mutations
  - pagination
related:
  title: Related
  links:
    - backend.md
    - frontend.md
    - application-patterns.md
    - logger.md
    - auth.md
---

# Typed API queries and mutations

`@prinpo/stack/query` exports native TanStack React Query and Stack's maintained Eden connector. Use it for API queries, mutations, cache invalidation, and Router loader integration. Native Eden remains separately available through `@prinpo/stack/client` for requests without Query.

## Shared client and provider

Create one factory result in the browser application's `src/client.ts`:

```tsx
import { createApiClient } from "@prinpo/stack/query";

import type { App } from "./server/app";

export const { api, eden, queryClient, ApiProvider } = createApiClient<App>(
  window.location.origin,
  { prefix: "/api" },
);
```

The inferred `App` contract comes from the assembled Elysia app; see [backend composition](backend.md). `createApiClient` returns:

| Member        | Purpose                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `api`         | Native Treaty client, optionally scoped to a static route prefix.                     |
| `eden`        | Standalone typed route-options proxy for Query hooks and imperative cache operations. |
| `queryClient` | The native QueryClient owned by this factory call.                                    |
| `ApiProvider` | A component accepting `children`, supplying QueryClientProvider with that same cache. |

Wrap the root route content in `<ApiProvider>…</ApiProvider>` as shown in [frontend providers](frontend.md). Import the same `eden` and `queryClient` into components and route loaders. The factory does not create an Eden React context or return `useEden` hooks.

Factory configuration passes through native options:

```ts
const client = createApiClient<App>(window.location.origin, {
  prefix: "/api",
  treaty: { headers: { "x-client": "my-app" } },
  query: { defaultOptions: { queries: { staleTime: 30_000 } } },
});
```

`CreateApiClientOptions<App, Prefix>` describes `prefix`, native Treaty `treaty` configuration, and native QueryClient `query` configuration. `ApiClient<App, Prefix>` describes the returned members. Each call creates an independent cache.

`prefix: "/api"` selects the route branch for both returned clients: `/api/hello` becomes `eden.hello.get` or `api.hello.get`, while request URLs and generated keys retain `api`. Omitting the prefix retains the complete route tree. Prefixes are checked against the app's routes; custom/nested prefixes require a second literal generic, for example `createApiClient<RpcApp, "/rpc/v1">(origin, { prefix: "/rpc/v1" })` for an app containing that branch.

## Queries and Router loaders

For an Elysia endpoint `GET /api/hello` whose query schema requires `name` and whose response is `{ message: string }`:

```tsx
import { useQuery } from "@prinpo/stack/query";

import { eden } from "./client";

export function Greeting() {
  const greeting = useQuery(eden.hello.get.queryOptions({ name: "Stack" }));
  return <p>{greeting.data?.message ?? "Loading…"}</p>;
}
```

Query methods (`get`, `head`, `options`) expose `queryOptions(input?, options?)`, `queryKey(input?)`, and `queryFilter(input?, filters?)`. Options accept native Query fields such as `staleTime`, `select`, and `retry`; the connector owns the generated query function and key.

A Router loader can populate the same cache, without a React context:

```ts
import { createFileRoute } from "@prinpo/stack/react";

import { eden, queryClient } from "../client";
import { Greeting } from "../features/greeting/view";

export const Route = createFileRoute("/greeting")({
  loader: () =>
    queryClient.query({
      ...eden.hello.get.queryOptions({ name: "Stack" }),
      staleTime: "static",
    }),
  component: Greeting,
});
```

This snippet assumes the view is in the named feature module and route generation has registered `/greeting`. Dynamic segments retain Treaty calling style: `/users/:id` becomes `eden.users({ id: "123" }).get.queryOptions()`; with `/api` scoping, the server route is `/api/users/:id`.

The proxy unwraps successful Treaty responses and throws failed response envelopes for Query, preserving `error.status` and `error.value`. Use `isStructuredApiError` from `@prinpo/stack/logger/client` for Stack's structured failure contract inside native callbacks; see [logging](logger.md). A status alone does not prove that an error came from your backend.

## Mutations

Mutation methods (`post`, `put`, `patch`, `delete`) expose `mutationOptions(options?)` and `mutationKey()`. For `POST /api/echo` accepting `{ message: string }`:

```tsx
import { useMutation } from "@prinpo/stack/query";

import { eden } from "./client";

export function EchoButton() {
  const echo = useMutation(eden.echo.post.mutationOptions());
  return (
    <button onClick={() => echo.mutate({ message: "Hello" })} disabled={echo.isPending}>
      Send
    </button>
  );
}
```

Variables are the body by default. For per-invocation request query or headers, use `mutationOptions({ request: true })` and pass the typed `{ body, query, headers }` request shape required by the route. Optional/bodyless inputs preserve their inferred invocation shape.

Use native `MutationCache` callbacks in the factory's `query` configuration for client-wide behavior. Reusable route `mutationOptions` can carry application-defined `meta` and endpoint callbacks. Applications own feedback, translation, redirects, and actions; Stack adds no second mutation policy layer. [Application patterns](application-patterns.md) describes this ownership boundary.

## Cache keys and filters

Generate identities from the route rather than reproducing key arrays:

```ts
await queryClient.invalidateQueries({
  queryKey: eden.hello.get.queryKey({ name: "Stack" }),
});

await queryClient.invalidateQueries(eden.messages.get.queryFilter());
await queryClient.invalidateQueries(eden.messages.get.infiniteQueryFilter());
```

A broad `queryFilter()` matches ordinary and infinite queries for its route/input. `queryFilter(input, { exact: true })` selects the ordinary query identity. `infiniteQueryFilter` selects infinite identities and supports initial-cursor selection. Native fields such as `type`, `exact`, and `predicate` remain usable as filter options.

Keys include route/input/path-parameter identity, not backend origin or client-level credentials. Separate caches for different backends whose paths overlap, and clear or invalidate user-specific data when authentication changes. Use generated filters for route families and keys for specific ordinary/infinite identities.

## Infinite queries and cancellation

For `GET /api/messages` with a supported top-level `cursor` query field, returning `{ items, nextCursor }`:

```tsx
import { useInfiniteQuery } from "@prinpo/stack/query";

import { eden } from "./client";

export function Messages() {
  const messages = useInfiniteQuery(
    eden.messages.get.infiniteQueryOptions(
      {},
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );
  return (
    <button
      disabled={!messages.hasNextPage || messages.isFetchingNextPage}
      onClick={() => void messages.fetchNextPage()}
    >
      Load more
    </button>
  );
}
```

Infinite helpers are exposed when the route's inferred query supports cursor pagination. Optional cursors default to a null initial cursor; required cursors require an explicit `initialCursor` in options. `infiniteQueryKey(input, { initialCursor })` produces the matching identity. Ordinary and infinite identities remain separate; initial cursors distinguish infinite sequences.

Query options support `eden: { abortOnUnmount: true }` to pass the Query cancellation signal into Treaty. `skipToken` from `@prinpo/stack/query` disables conditional queries through the options factories; a skipped query's generated function is absent and it is disabled.

For per-request query headers, wrapped input uses an explicit `headers` field, for example `{ query: { name: "Stack" }, headers: undefined }`. Inputs containing literal fields named `query` or `headers` can require this disambiguation. Some route segments collide with reserved proxy helpers; use the raw returned `api` Treaty client for those endpoints.

## Explicit composition APIs

Use `createApiClient` for standard assembly. The retained lower-level exports support custom composition:

| Export                                                                     | Contract                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `createEdenOptionsProxy<App>({ client })`                                  | Decorates an existing native Treaty client with route options, keys, and filters. Works outside React.                                        |
| `createEdenContext<App>()`                                                 | Returns `EdenProvider`, `useEden`, and `useEdenClient`. The provider accepts a native Treaty `client`; consumer hooks require it.             |
| `createEdenTanStackQuery<App>()`                                           | Returns the same context/provider/hooks contract as `createEdenContext`.                                                                      |
| `edenQueryOptions({ path, input, fetch, opts? })`                          | Low-level query factory when providing request execution yourself. `fetch(input, signal?)` must resolve successful data or throw failures.    |
| `edenMutationOptions({ path, mutate, opts? })`                             | Low-level mutation factory; `mutate(input)` resolves successful data or throws failures.                                                      |
| `edenInfiniteQueryOptions({ path, input, fetch, initialPageParam, opts })` | Low-level infinite factory with explicit starting page and required options including `getNextPageParam`; `fetch` receives input with cursor. |
| `getQueryKey({ path, input?, pathParams?, type?, initialPageParam? })`     | Creates a connector key; `type` is `query`, `infinite`, or `any`. Use proxy helpers where possible to retain route typing.                    |
| `getMutationKey({ path })`                                                 | Creates a connector mutation key from route/method path segments.                                                                             |

`path` includes the HTTP method, for example `["api", "hello", "get"]`. Low-level query/infinite factories also accept `inputForKey` for skipped queries and ordered `pathParams` for dynamic-route identity. Their native Query options remain under `opts`; connector-owned fields such as query functions/keys are reserved.

For explicit React context composition, provide both the Query cache and Eden client:

```tsx
import type { ReactNode } from "react";

import { treaty } from "@prinpo/stack/client";
import { QueryClient, QueryClientProvider, createEdenContext } from "@prinpo/stack/query";

import type { App } from "./server/app";

const client = treaty<App>(window.location.origin);
const queryClient = new QueryClient();
export const { EdenProvider, useEden, useEdenClient } = createEdenContext<App>();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <EdenProvider client={client}>{children}</EdenProvider>
    </QueryClientProvider>
  );
}
```

Deprecated `queryClient` arguments on Eden's provider/proxy remain accepted but unused. The native QueryClientProvider owns the cache in this explicit pattern.

## Exported type families

All of these connector types are exported through `@prinpo/stack/query`:

| Purpose                        | Types                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factory and provider contracts | `CreateEdenOptionsProxyOptions`, `CreateEdenContextResult`, `EdenProviderProps`, `CreateEdenTanStackQueryResult`.                                                                                                                                                                                                                                                                                                                               |
| Query keys                     | `GetQueryKeyOptions`, `GetMutationKeyOptions`, `EdenQueryKey`, `EdenMutationKey`, `EdenQueryKeyMeta`, `EdenQueryKeyPathParam`, `QueryType`.                                                                                                                                                                                                                                                                                                     |
| Options/results                | `EdenQueryBaseOptions`, `EdenQueryOptions`, `EdenQueryOptionsResult`, `EdenMutationOptions`, `EdenMutationOptionsArgs`, `EdenMutationOptionsIn`, `EdenMutationOptionsOut`, `EdenMutationOptionsResult`, `EdenInfiniteQueryOptions`, `EdenInfiniteQueryOptionsArgs`, `EdenInfiniteQueryOptionsResult`.                                                                                                                                           |
| Proxy and procedure decorators | `EdenOptionsProxy`, `DecoratedRouteMethods`, `DecorateRoute`, `DecorateRoutes`, `DecorateQueryProcedure`, `DecorateMutationProcedure`, `DecorateInfiniteQueryProcedure`, `ExtractRouteDef`, `ExtractCursorType`, `HasCursorInput`, `inferInput`, `inferOutput`, `inferError`.                                                                                                                                                                   |
| Route/request inference        | `ExtractRoutes`, `GetRoute`, `RouteDefinition`, `ExtractPathParams`, `PathParamsToObject`, `HttpMethod`, `HttpQueryMethod`, `HttpMutationMethod`, `IsQueryMethod`, `IsMutationMethod`, `InferRouteInput`, `InferRouteMutationInput`, `InferRouteOutput`, `InferRouteOutputAll`, `InferRouteError`, `InferRouteBody`, `InferRouteHeaders`, `InferRouteOptions`, `InferRouteParams`, `InferRouteQuery`, `MutationRequestInput`, `EdenFetchError`. |
| Generic type utilities         | `DeepPartial`, `Simplify`, `IsAny`, `IsNever`, `IsUnknown`.                                                                                                                                                                                                                                                                                                                                                                                     |

Use inferred proxy option types for ordinary feature code; explicit types are useful when building reusable application helpers.

## Native references and attribution

Use native [TanStack Query documentation](https://tanstack.com/query/latest/docs/framework/react/overview) for hooks, QueryClient, cache callbacks, retry policy, and lifecycle options; import those APIs through `@prinpo/stack/query`. Stack owns the Eden integration described here. This connector is adapted from eden-tanstack-react-query v0.5.0 by Ilya Zhidkov and contributors under Apache-2.0, with attribution and modification records retained in the installed package's `src/eden-query/` directory. SSR is outside Stack's documented application lifecycle.
