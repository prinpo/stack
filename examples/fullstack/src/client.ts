import { createApiClient } from "@prinpo/stack/query";

import type { App } from "./server/app";

export const { api, eden, queryClient, ApiProvider } = createApiClient<App>(
  window.location.origin,
  { prefix: "/api" },
);
