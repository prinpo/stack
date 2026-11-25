import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { MutationCache, createApiClient } from "@prinpo/stack/query";

import type { App } from "./server/app";

import { i18n } from "./i18n/client";

export const { api, eden, queryClient, ApiProvider } = createApiClient<App>(
  window.location.origin,
  {
    prefix: "/api",
    getLocale: i18n.getLocale,
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
