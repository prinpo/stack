// Modified for Prinpo Stack. See src/eden-query/README.md.

import { QueryClient } from "@prinpo/stack/query";

/**
 * Creates a QueryClient configured for testing.
 * - Disables retries for faster test failures
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}
