import { type Treaty, treaty } from "@prinpo/stack/client";
import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { logger } from "@prinpo/stack/logger/elysia";
import { MutationCache, createEdenOptionsProxy } from "@prinpo/stack/query";
import { Elysia } from "@prinpo/stack/server";
import { expectTypeOf } from "vite-plus/test";

const logging = logger({ service: "types", silent: true, persistence: false });
const routes = new Elysia().use(logging).post("/order", ({ apiError }) =>
  apiError(409, {
    message: "Already confirmed",
    code: "CONFIRMED",
    data: { orderId: "order-123" },
    internal: { processor: "private" },
  }),
);
const optional: { message: string; code?: "OPTIONAL"; data?: { retryAfter: number } } = {
  message: "Optional",
};
const optionalPayload: { message: string; code: "TOP"; data?: { orderId: string } } = {
  message: "Optional payload",
  code: "TOP",
};
const optionalOverride: { message: string; code?: "TOP"; data: { code: "DATA" } } = {
  message: "Optional override",
  data: { code: "DATA" },
};
const unionPayload: { message: string; data: { kind: "one"; one: 1 } | { kind: "two"; two: 2 } } = {
  message: "Union data",
  data: Math.random() > 0.5 ? { kind: "one", one: 1 } : { kind: "two", two: 2 },
};
const app = new Elysia()
  .use(logging)
  .use(routes)
  .get("/ok", () => ({ ok: true }))
  .get("/optional", ({ apiError }) => apiError(400, optional))
  .get("/optional-payload", ({ apiError }) => apiError(409, optionalPayload))
  .get("/optional-override", ({ apiError }) => apiError(409, optionalOverride))
  .get("/union", ({ apiError }) => apiError(409, unionPayload))
  .get("/choices", ({ query, apiError }) => {
    if (query.kind === "one")
      return apiError(409, { message: "One", code: "ONE", data: { one: 1 } });
    if (query.kind === "two")
      return apiError(409, { message: "Two", code: "TWO", data: { two: 2 } });
    return apiError(404, { message: "No application code" });
  });
const api = treaty(app);
const eden = createEdenOptionsProxy<typeof app>({ client: api });

export function loggerContractTypes() {
  function checkDataUnion(error: Treaty.Error<typeof api.union.get>) {
    if (error.status === 409 && error.value.data.kind === "one") {
      expectTypeOf(error.value.data.one).toEqualTypeOf<1>();
    }
  }
  void checkDataUnion;
  type Payload = Extract<Treaty.Error<(typeof api)["optional-payload"]["get"]>, { status: 409 }>;
  expectTypeOf<Payload["value"]["data"]["orderId"]>().toEqualTypeOf<string | undefined>();
  type Override = Extract<Treaty.Error<(typeof api)["optional-override"]["get"]>, { status: 409 }>;
  expectTypeOf<Override["value"]["data"]["code"]>().toEqualTypeOf<"TOP" | "DATA" | undefined>();
  expectTypeOf<Treaty.Data<typeof api.ok.get>>().toEqualTypeOf<{ ok: boolean }>();
  type Optional = Extract<Treaty.Error<typeof api.optional.get>, { status: 400 }>;
  expectTypeOf<Optional["value"]["data"]>().toMatchTypeOf<
    { code?: "OPTIONAL"; retryAfter?: number } | undefined
  >();
  function checkVariants(error: Treaty.Error<typeof api.choices.get>) {
    if (isStructuredApiError(error) && error.status === 409 && error.value.data.code === "ONE") {
      expectTypeOf(error.value.data.one).toEqualTypeOf<1>();
    }
    if (error.status === 404) {
      expectTypeOf(error.value.message).toEqualTypeOf<"No application code">();
    }
  }
  void checkVariants;
  new MutationCache({
    onError(error) {
      if (isStructuredApiError(error)) {
        expectTypeOf(error.value.message).toEqualTypeOf<string>();
        expectTypeOf(error.value.data?.code).toEqualTypeOf<string | undefined>();
      }
    },
  });
  eden.order.post.mutationOptions({
    onError(error) {
      if (isStructuredApiError(error) && error.status === 409) {
        expectTypeOf(error.value.status).toEqualTypeOf<409>();
        expectTypeOf(error.value.message).toEqualTypeOf<"Already confirmed">();
        expectTypeOf(error.value.data.code).toEqualTypeOf<"CONFIRMED">();
        expectTypeOf(error.value.data.orderId).toEqualTypeOf<"order-123">();
        // @ts-expect-error Server diagnostics are not part of the public error contract.
        void error.value.internal;
      }
    },
  });
}
