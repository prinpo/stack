import { treaty } from "@prinpo/stack/client";
import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { logger } from "@prinpo/stack/logger/elysia";
import { MutationCache, QueryClient, createEdenOptionsProxy } from "@prinpo/stack/query";
import { Elysia } from "@prinpo/stack/server";
import { expect, test } from "vite-plus/test";

test("the shared guard validates an Eden failure without changing its endpoint data", () => {
  const error: unknown = {
    status: 409,
    value: { status: 409, message: "Confirmed", data: { code: "CONFIRMED", orderId: 123 } },
  };
  expect(isStructuredApiError(error)).toBe(true);
  if (isStructuredApiError(error)) {
    expect(error.value.data?.orderId).toBe(123);
  }
  for (const other of [
    new Error("offline"),
    { status: 503, value: new Error("offline") },
    { status: 422, value: { type: "validation", on: "body" } },
    { status: 400, value: "Bad request" },
  ]) {
    expect(isStructuredApiError(other)).toBe(false);
  }
  expect(isStructuredApiError({ status: 500, value: { status: 500, message: "Failure" } })).toBe(
    true,
  );
});

test("the same guard handles real failures in both native Query error callbacks", async () => {
  const app = new Elysia()
    .use(logger({ silent: true, persistence: false }))
    .post("/order", ({ apiError }) =>
      apiError(409, { message: "Confirmed", code: "CONFIRMED", data: { orderId: 123 } }),
    );
  const eden = createEdenOptionsProxy<typeof app>({ client: treaty(app) });
  const handled: unknown[] = [];
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onError(error) {
        if (isStructuredApiError(error)) handled.push(error.value.message);
      },
    }),
  });
  const options = eden.order.post.mutationOptions({
    onError(error) {
      if (isStructuredApiError(error) && error.status === 409)
        handled.push(error.value.data.orderId);
    },
  });
  try {
    const mutation = client.getMutationCache().build(client, options);
    await expect(mutation.execute(undefined)).rejects.toMatchObject({ status: 409 });
    expect(handled).toEqual(["Confirmed", 123]);
  } finally {
    client.clear();
  }
});
