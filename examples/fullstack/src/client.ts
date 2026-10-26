import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { MutationCache, createApiClient } from "@prinpo/stack/query";

import type { App } from "./server/app";

export const { api, eden, queryClient, ApiProvider } = createApiClient<App>(
  window.location.origin,
  {
    prefix: "/api",
    query: {
      mutationCache: new MutationCache({
        onError(error) {
          if (isStructuredApiError(error)) {
            console.info("Structured API failure", error.status, error.value.message);
          }
        },
      }),
    },
  },
);
