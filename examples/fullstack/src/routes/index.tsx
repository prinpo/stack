import { useInfiniteQuery, useMutation, useQuery } from "@prinpo/stack/query";
import { createFileRoute } from "@prinpo/stack/react";
import { type FormEvent } from "react";

import { eden, queryClient } from "../client";

const greetingInput = { name: "Stack" };

export const Route = createFileRoute("/")({
  loader: () =>
    queryClient.query({
      ...eden.hello.get.queryOptions(greetingInput),
      staleTime: "static",
    }),
  component: Home,
});

function Home() {
  const greeting = useQuery(eden.hello.get.queryOptions(greetingInput));
  const echo = useMutation(eden.echo.post.mutationOptions());
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
