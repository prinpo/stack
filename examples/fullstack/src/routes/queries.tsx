import { useInfiniteQuery, useMutation, useQuery } from "@prinpo/stack/query";
import { createFileRoute } from "@prinpo/stack/react";
import { type FormEvent } from "react";

import { eden, queryClient } from "../client";

const greetingInput = { name: "Stack" };

export const Route = createFileRoute("/queries")({
  loader: () =>
    queryClient.query({
      ...eden.hello.get.queryOptions(greetingInput),
      staleTime: "static",
    }),
  component: Queries,
});

function Queries() {
  const greeting = useQuery(eden.hello.get.queryOptions(greetingInput));
  const echo = useMutation(eden.echo.post.mutationOptions());
  const failure = useMutation(
    eden.error.post.mutationOptions({
      onError(error) {
        if (isStructuredApiError(error) && error.status === 409) {
          console.info("Endpoint-specific order", error.value.data.orderId);
        }
      },
    }),
  );
  const messages = useInfiniteQuery(
    eden.messages.get.infiniteQueryOptions(
      {},
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      },
    ),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = new FormData(event.currentTarget).get("message");
    if (typeof message === "string") echo.mutate({ message });
  }

  return (
    <section>
      <p className="eyebrow">TYPED API QUERY</p>
      <h2>{greeting.data?.message ?? "Loading greeting…"}</h2>
      <p>This greeting is shared between the Router loader and TanStack Query’s cache.</p>
      {greeting.isError && <p role="alert">The API greeting could not be loaded.</p>}
      <button
        type="button"
        disabled={greeting.isFetching}
        onClick={() => {
          void queryClient.invalidateQueries({
            queryKey: eden.hello.get.queryKey(greetingInput),
          });
        }}
      >
        {greeting.isFetching ? "Refreshing…" : "Refresh greeting"}
      </button>
      <form onSubmit={submit}>
        <label htmlFor="message">Send a typed API mutation</label>
        <div className="input-row">
          <input id="message" name="message" defaultValue="Connected through Stack" required />
          <button type="submit" disabled={echo.isPending}>
            {echo.isPending ? "Sending…" : "Send message"}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {echo.isError ? "The API could not accept the message." : echo.data?.message}
      </p>
      <h3>Load the connection in pages</h3>
      <button type="button" disabled={failure.isPending} onClick={() => failure.mutate()}>
        Try a structured API error
      </button>
      {isStructuredApiError(failure.error) && (
        <p role="status">
          {failure.error.value.message} — {failure.error.value.data?.fix}
        </p>
      )}
      <ul>
        {messages.data?.pages.flatMap((page) =>
          page.items.map((item) => <li key={item.id}>{item.message}</li>),
        )}
      </ul>
      {messages.isError && <p role="alert">Messages could not be loaded.</p>}
      <button
        type="button"
        disabled={!messages.hasNextPage || messages.isFetchingNextPage}
        onClick={() => {
          void messages.fetchNextPage();
        }}
      >
        {messages.isFetchingNextPage
          ? "Loading…"
          : messages.hasNextPage
            ? "Load more"
            : "All messages loaded"}
      </button>
    </section>
  );
}
import { isStructuredApiError } from "@prinpo/stack/logger/client";
