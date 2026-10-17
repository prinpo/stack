import type { InfiniteData } from "@prinpo/stack/query";

import { createApiClient, useQuery, useQueryClient } from "@prinpo/stack/query";
import { Elysia, t } from "@prinpo/stack/server";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, expectTypeOf, test } from "vite-plus/test";

const requests: Request[] = [];
const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .get(
    "/api/users",
    ({ query, request }) => ({
      name: query.name,
      header: request.headers.get("x-client"),
    }),
    { query: t.Object({ name: t.String() }) },
  )
  .get("/api/users/:id", ({ params }) => ({ id: params.id }))
  .post("/api/users", ({ body }) => ({ id: "created", name: body.name }), {
    body: t.Object({ name: t.String() }),
  })
  .get("/api/feed", ({ query }) => ({ items: [query.cursor ?? 0], next: null }), {
    query: t.Object({ cursor: t.Optional(t.Numeric()) }),
  })
  .get("/rpc/v1/hello", () => ({ message: "Nested prefix" }));

type App = typeof app;

const fetcher: typeof fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return app.handle(request);
  },
  { preconnect() {} },
);

function client() {
  return createApiClient<App>("http://localhost", {
    prefix: "/api",
    treaty: { fetcher, headers: { "x-client": "Stack" } },
    query: { defaultOptions: { queries: { retry: false, gcTime: Infinity } } },
  });
}

const clients: Array<{ queryClient: ReturnType<typeof client>["queryClient"] }> = [];
afterEach(() => {
  clients.splice(0).forEach(({ queryClient }) => queryClient.clear());
  requests.length = 0;
});

test("scoped query options retain the actual prefix, typed cache, and static loader behavior", async () => {
  const setup = client();
  clients.push(setup);
  const options = {
    ...setup.eden.users.get.queryOptions({ name: "Ada" }),
    staleTime: "static" as const,
  };

  expect(await setup.queryClient.query(options)).toEqual({ name: "Ada", header: "Stack" });
  expect(await setup.queryClient.query(options)).toEqual({ name: "Ada", header: "Stack" });
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]!.url).pathname).toBe("/api/users");
  expect(options.queryKey[0]).toEqual(["api", "users", "get"]);

  const cached = setup.queryClient.getQueryData(options.queryKey);
  expectTypeOf(cached).toEqualTypeOf<{ name: string; header: string | null } | undefined>();
  expect(cached).toEqual({ name: "Ada", header: "Stack" });
  expect(setup.queryClient.getDefaultOptions().queries?.retry).toBe(false);
});

test("scoped raw calls, mutations, dynamic parameters, and infinite queries share the prefix", async () => {
  const setup = client();
  clients.push(setup);
  expect((await setup.api.users({ id: "42" }).get()).data).toEqual({ id: "42" });
  const mutation = setup.queryClient
    .getMutationCache()
    .build(setup.queryClient, setup.eden.users.post.mutationOptions());
  expect(await mutation.execute({ name: "Ada" })).toEqual({ id: "created", name: "Ada" });
  const options = setup.eden.feed.get.infiniteQueryOptions(
    {},
    {
      initialCursor: 2,
      getNextPageParam: () => undefined,
    },
  );
  const data = await setup.queryClient.fetchInfiniteQuery(options);
  expect(data.pages).toEqual([{ items: [2], next: null }]);
  expect(options.queryKey[0]).toEqual(["api", "feed", "get"]);
  expectTypeOf(setup.queryClient.getQueryData(options.queryKey)).toEqualTypeOf<
    InfiniteData<{ items: number[]; next: null }, number> | undefined
  >();
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/users/42",
    "/api/users",
    "/api/feed",
  ]);
});

test("ApiProvider supplies the factory cache and scoped Eden hooks", async () => {
  const setup = client();
  clients.push(setup);
  const { result } = renderHook(
    () => {
      const eden = setup.useEden();
      return {
        queryClient: useQueryClient(),
        api: setup.useEdenClient(),
        query: useQuery(eden.users.get.queryOptions({ name: "Grace" })),
      };
    },
    { wrapper: setup.ApiProvider },
  );

  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  expect(result.current.queryClient).toBe(setup.queryClient);
  expect(result.current.query.data).toEqual({ name: "Grace", header: "Stack" });
  expect((await result.current.api.users({ id: "7" }).get()).data).toEqual({ id: "7" });
  expect(setup.queryClient.getQueryData(setup.eden.users.get.queryKey({ name: "Grace" }))).toEqual(
    result.current.query.data,
  );
});

test("factory calls own separate caches even when their route keys match", async () => {
  const first = client();
  const second = client();
  clients.push(first, second);
  await first.queryClient.query(first.eden.users.get.queryOptions({ name: "Ada" }));
  expect(
    second.queryClient.getQueryData(second.eden.users.get.queryKey({ name: "Ada" })),
  ).toBeUndefined();
});

test("omitting the prefix preserves the complete route tree", async () => {
  const setup = createApiClient<App>("http://localhost", { treaty: { fetcher } });
  clients.push(setup);
  expect(await setup.queryClient.query(setup.eden.health.get.queryOptions())).toEqual({ ok: true });
  expect((await setup.api.api.users({ id: "unscoped" }).get()).data).toEqual({ id: "unscoped" });
  const defaults = createApiClient<App>("http://localhost");
  clients.push(defaults);
  expect(defaults.eden.health.get.queryKey()[0]).toEqual(["health", "get"]);
});

test("custom nested prefixes retain their full URL and key identity", async () => {
  const setup = createApiClient<App, "/rpc/v1/">("http://localhost", {
    prefix: "/rpc/v1/",
    treaty: { fetcher },
  });
  clients.push(setup);
  expect(await setup.queryClient.query(setup.eden.hello.get.queryOptions())).toEqual({
    message: "Nested prefix",
  });
  expect(setup.eden.hello.get.queryKey()[0]).toEqual(["rpc", "v1", "hello", "get"]);
  expect(new URL(requests[0]!.url).pathname).toBe("/rpc/v1/hello");
});

function typeChecks() {
  const scoped = client();
  // @ts-expect-error Prefix scoping removes the outer api branch.
  void scoped.eden.api;
  // @ts-expect-error Required query fields stay required after prefix scoping.
  scoped.eden.users.get.queryOptions();
  // @ts-expect-error Mutation bodies retain their route types.
  void scoped.eden.users.post.mutationOptions().mutationFn({ name: 123 });
  // @ts-expect-error Prefixes must exist in the app's route tree.
  createApiClient<App, "/missing">("http://localhost", { prefix: "/missing" });
  // @ts-expect-error A custom prefix generic requires the matching runtime prefix.
  createApiClient<App, "/rpc/v1">("http://localhost", {});
}
void typeChecks;
