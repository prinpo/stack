import { Elysia, t } from "@prinpo/stack/server";

import { setupPlugin } from "../plugins/setup";

export const errorRoutes = new Elysia().use(setupPlugin).post(
  "/api/error",
  ({ apiError }) => {
    return apiError(409, {
      message: "This example order is already confirmed",
      code: "ORDER_CONFIRMED",
      why: "An order can only be confirmed once",
      fix: "Open the existing order",
      data: { orderId: "example-order" },
    });
  },
  { body: t.Optional(t.Undefined()) },
);
