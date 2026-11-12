import { createFileRoute } from "@prinpo/stack/react";

import { queryClient } from "../client";
import { eden } from "../client";
import { Queries, greetingInput } from "../features/queries/view";

export const Route = createFileRoute("/queries")({
  loader: () =>
    queryClient.query({
      ...eden.hello.get.queryOptions(greetingInput),
      staleTime: "static",
    }),
  component: Queries,
});
