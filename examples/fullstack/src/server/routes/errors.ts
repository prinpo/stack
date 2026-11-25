import { Elysia, t } from "@prinpo/stack/server";

import { setupPlugin } from "../plugins/setup";

export const errorRoutes = new Elysia()
  .use(setupPlugin)
  .post(
    "/api/error",
    ({ localizedError }) => localizedError("ORDER_CONFIRMED", { orderId: "example-order" }),
    { body: t.Optional(t.Undefined()) },
  );
