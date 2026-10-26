# Eden Query connector

`@prinpo/stack/query` exports native TanStack React Query and all functions/types adapted from eden-tanstack-react-query. Stack pins Query 5.102.8 as a regular dependency; applications continue to own compatible React and React DOM instances. The existing `@prinpo/stack/client` exports native Eden independently.

This is an initial import for review. The source lives in [src/eden-query](../src/eden-query/), with original module boundaries and algorithms preserved. Credit belongs to **Ilya Zhidkov and contributors**; the source remains **Apache-2.0**. See [provenance and modifications](../src/eden-query/README.md) and [the preserved license](../src/eden-query/LICENSE).

## Create the client and provider

```tsx
import { createApiClient } from "@prinpo/stack/query";

import type { App } from "./server/app";

export const { api, eden, queryClient, ApiProvider } = createApiClient<App>(
  window.location.origin,
  { prefix: "/api" },
);
```

The factory creates a native Treaty client, QueryClient, standalone options proxy, and Query provider. Create it once per browser application and export the result from your client module. Components and loaders import the same `eden`, `api`, and `queryClient` instances. Wrap the root route's content in `<ApiProvider>…</ApiProvider>`; it supplies QueryClientProvider with the factory's cache, with no client props or Eden context. The [fullstack root route](../examples/fullstack/src/routes/__root.tsx) shows this with Stack's existing Router renderer.

With `prefix: "/api"`, write `eden.hello.get` and `api.hello.get` for `/api/hello`. The prefix selects a branch of the full clients: requests still use `/api/hello`, and generated keys retain `api`. Both the `eden` proxy and raw `api` client use this scope. Omitting `prefix` preserves the complete native route tree.

Pass native options through `treaty` and `query`:

```ts
const client = createApiClient<App>(window.location.origin, {
  prefix: "/api",
  treaty: { headers: { "x-client": "my-app" } },
  query: { defaultOptions: { queries: { staleTime: 30_000 } } },
});
```

For custom or nested prefixes, supply the prefix literal as a second generic so TypeScript can select the exact route branch:

```ts
// For an app whose routes include /rpc/v1/hello:
const client = createApiClient<RpcApp, "/rpc/v1">(window.location.origin, {
  prefix: "/rpc/v1",
});
```

The `/api` overload needs only the app generic. Prefixes are checked against the app's route tree. Each factory owns its QueryClient; separate factory calls have separate caches. The existing low-level `createEdenOptionsProxy`, `createEdenContext`, `createEdenTanStackQuery`, and QueryClientProvider APIs remain available for explicit composition. The upstream context factories still return EdenProvider, useEden, and useEdenClient separately; `createApiClient` does not create or return an Eden context or hooks.

## Queries, loaders, and keys

For the example's `GET /api/hello?name=Stack` endpoint:

```tsx
import { useQuery } from "@prinpo/stack/query";

import { eden, queryClient } from "./client";

function Greeting() {
  const greeting = useQuery(eden.hello.get.queryOptions({ name: "Stack" }));
  return <p>{greeting.data?.message}</p>;
}

// A Router loader can prefetch using the standalone proxy and shared cache.
await queryClient.query({
  ...eden.hello.get.queryOptions({ name: "Stack" }),
  staleTime: "static",
});

// Invalidate a key without manually reproducing its structure.
await queryClient.invalidateQueries({
  queryKey: eden.hello.get.queryKey({ name: "Stack" }),
});
```

Dynamic paths retain Eden's calling style: a route `/users/:id` becomes `eden.users({ id: "123" }).get.queryOptions()`. Queries expose `queryOptions`, `queryKey`, and `queryFilter`. The proxy unwraps successful Eden responses and throws their error envelope on failure, preserving `error.status` and `error.value` for Query consumers.

## Mutations and infinite queries

```tsx
import { useInfiniteQuery, useMutation } from "@prinpo/stack/query";

const echo = useMutation(eden.echo.post.mutationOptions());
echo.mutate({ message: "Hello from Stack" });

const messages = useInfiniteQuery(
  eden.messages.get.infiniteQueryOptions(
    {},
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  ),
);
// Trigger from an event handler.
void messages.fetchNextPage();
```

The snippet's hooks belong inside a component; the [example route](../examples/fullstack/src/routes/index.tsx) shows the complete implementation. Mutation methods also expose `mutationKey()`. Body-only variables are the default. Use `mutationOptions({ request: true })` when each invocation needs `{ body, query, headers }` variables.

Infinite helpers are exposed for supported top-level cursor schemas. Optional cursors default to a null initial cursor; required cursors need an explicit `initialCursor` in the options. `infiniteQueryKey(input, { initialCursor })` matches the infinite options' identity. The cursor schema determines page-parameter types.

## Query filters

A native Query filter is an object describing which cached queries an operation should match. The connector's helpers construct that object using its own key conventions:

```ts
// A broad filter matches ordinary and infinite queries for this route/input.
await queryClient.invalidateQueries(eden.messages.get.queryFilter());

// Match infinite queries for the route.
await queryClient.invalidateQueries(eden.messages.get.infiniteQueryFilter());
```

You can also pass native filter fields such as `exact`, `type`, and `predicate` as the second argument. `queryFilter(input, { exact: true })` targets the ordinary query identity; `infiniteQueryFilter` selects infinite identities, with optional initial-cursor filtering. Keys and native `invalidateQueries({ queryKey })` remain available if you prefer them. The initial import retains both styles.

## Retained API and boundaries

The public entry point also retains `createEdenContext`, low-level `edenQueryOptions`, `edenMutationOptions`, `edenInfiniteQueryOptions`, `getQueryKey`, `getMutationKey`, and every upstream exported type. [The connector index](../src/eden-query/index.ts) lists them. Deprecated `queryClient` arguments on the original low-level factories are still accepted and unused; use `ApiProvider` for the unified factory or native QueryClientProvider for explicit composition.

Preserved upstream behaviors to consider during review:

- Keys omit backend identity and client-level credentials. Use separate QueryClients for backends with overlapping routes and handle cache clearing when authentication changes.
- Query cancellation is forwarded to Treaty when `eden: { abortOnUnmount: true }` is set in query options.
- Wrapped query input requires an explicit `headers` field, for example `{ query: input, headers: undefined }`; fields named `query` or `headers` have disambiguation rules.
- Some child paths after method-named segments collide with reserved proxy helpers. Raw Treaty remains available for these routes.
- `skipToken` from `@prinpo/stack/query` is supported by the options factories. Ordinary and infinite queries use separate cache identities.

SSR, new pagination conventions, and changes to these contracts are deferred for further connector work.

## Deferred backend errors and mutation feedback

The optional [logger Block](logger.md) now integrates Elysia with evlog and provides a structured-error guard inside native client-wide and endpoint-specific callbacks. HTTP and type checks verify its error contract through Eden and this connector. Structural recognition does not prove provenance, and status 503 alone cannot distinguish backend and transport failures.

Follow-up work, in order:

1. Associate an application-defined action with an error. The action interface remains deferred; basic structured-error identification is already available.
2. Revisit a mutation feedback example using native MutationCache callbacks and reusable `.mutationOptions({ meta: … })` definitions. Applications can interpret their own metadata to show notifications, translate messages, log outcomes, or perform other actions.

Stack supplies headless integration logic; applications own presentation, translation, and action behavior. No toaster, i18n dependency, required feedback policy, or additional mutation lifecycle abstraction is planned for this example. Start with mutations; query feedback can be considered later. The [logging guide](logger.md) documents the implemented structured-error guard; application actions and the feedback example remain deferred.

## Validation

```sh
bunx --bun vp check
bunx --bun vp test
bunx --bun vp test --project eden-query
bunx --bun vp run example:check
```

The imported tests cover runtime routing, real Treaty requests, errors, cache identity, pagination, React context/hooks, and compile-time input/output/cache inference. Test helpers use Vite+ and a dedicated happy-dom environment. The fullstack example is the starting point for browser verification.

The initial import passes 551 connector tests and the existing 18 Stack tests, plus repository and example format/lint/type checks. Browser verification exercised the greeting query, key invalidation/refetch, echo mutation, and all three cursor pages through the development proxy without console errors. The 12 connector module bodies and exported declarations were compared against the baseline after normalizing import paths, comments, and formatting; no algorithm or type-contract changes were introduced. Production qualification remains deferred.

The API client factory has additional coverage for prefix routing/key identity, scoped raw calls, native Query hooks using the standalone proxy, the Query provider, independent caches, native options, and the current loader query method.
