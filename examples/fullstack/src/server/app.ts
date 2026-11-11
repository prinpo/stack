import { Elysia, t } from "@prinpo/stack/server";

import { ENV } from "../env/server";
import { db } from "./database";
import { notebooks, notes } from "./database/schema";
import { errors } from "./errors";
import { logging } from "./logging";
import { createNotebookBody } from "./validation";

export const app = new Elysia()
  .use(logging)
  .use(errors)
  .get("/api/notebooks", () =>
    db.query.notebooks.findMany({ with: { notes: true }, orderBy: { id: "asc" } }),
  )
  .post("/api/notebooks", ({ body }) => db.insert(notebooks).values(body).returning(), {
    body: createNotebookBody,
  })
  .get("/api/notes", () =>
    db.query.notes.findMany({ with: { notebook: true }, orderBy: { id: "asc" } }),
  )
  .post("/api/notes", ({ body }) => db.insert(notes).values(body).returning(), {
    body: t.Object({
      text: t.String({ minLength: 1, maxLength: 500 }),
      notebookId: t.Optional(t.Integer({ minimum: 1 })),
    }),
  })
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
  })
  .get("/api/hello", ({ query }) => ({ message: `Hello, ${query.name}!` }), {
    query: t.Object({ name: t.String({ minLength: 1 }) }),
  })
  .post("/api/echo", ({ body }) => ({ message: body.message }), {
    body: t.Object({ message: t.String({ minLength: 1 }) }),
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
