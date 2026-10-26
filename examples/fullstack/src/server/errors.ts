import { Elysia } from "@prinpo/stack/server";

import { logging } from "./logging";

export const errors = new Elysia().use(logging).post("/api/error", ({ apiError }) => {
  return apiError(409, {
    message: "This example order is already confirmed",
    code: "ORDER_CONFIRMED",
    why: "An order can only be confirmed once",
    fix: "Open the existing order",
    data: { orderId: "example-order" },
  });
});
