import { createApiClient } from "@prinpo/stack/query";

import type { App } from "./server/app";

export const { api, eden, queryClient, ApiProvider, useEden, useEdenClient } = createApiClient<App>(
  window.location.origin,
  { prefix: "/api" },
);
