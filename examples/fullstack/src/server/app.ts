import { Elysia, t } from "@prinpo/stack/server";

export const app = new Elysia()
  .get("/api/hello", ({ query }) => ({ message: `Hello, ${query.name}!` }), {
    query: t.Object({ name: t.String({ minLength: 1 }) }),
  })
  .post("/api/echo", ({ body }) => ({ message: body.message }), {
    body: t.Object({ message: t.String({ minLength: 1 }) }),
  })
  .post("/api/error", ({ status }) => {
    return status(400);
  })
  .get(
    "/api/messages",
    ({ query }) => {
      const cursor = query.cursor ?? 0;
      const messages = [
        "Queries use native TanStack Query hooks.",
        "Eden paths create typed query options and keys.",
        "Router loaders can prefetch the same queries.",
        "Mutations preserve the Elysia request contract.",
        "Infinite queries load the next page by cursor.",
        "Stack owns the connector and its pinned dependencies.",
      ];
      const items = messages.slice(cursor, cursor + 2).map((message, index) => ({
        id: cursor + index,
        message,
      }));
      const nextCursor = cursor + items.length < messages.length ? cursor + items.length : null;
      return { items, nextCursor };
    },
    {
      query: t.Object({ cursor: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })) }),
    },
  );

export type App = typeof app;
