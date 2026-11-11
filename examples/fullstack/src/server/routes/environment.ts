import { Elysia } from "@prinpo/stack/server";

import { ENV } from "../../env-gen/server";

export const environmentRoutes = new Elysia()
  // Teaching endpoint: these four settings contain dummy strings, including the
  // secret-classified examples. Keep real application credentials out of it.
  .get("/api/env", ({ set }) => {
    set.headers["cache-control"] = "no-store";
    return {
      SERVER_PUBLIC_STATIC: ENV.SERVER_PUBLIC_STATIC,
      SERVER_PUBLIC_DYNAMIC: ENV.SERVER_PUBLIC_DYNAMIC,
      SERVER_SECRET_STATIC: ENV.SERVER_SECRET_STATIC,
      SERVER_SECRET_DYNAMIC: ENV.SERVER_SECRET_DYNAMIC,
    };
  });
