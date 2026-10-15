import { Elysia, t } from "@prinpo/stack/server";

export const app = new Elysia()
  .get("/api/hello", ({ query }) => ({ message: `Hello, ${query.name}!` }), {
    query: t.Object({ name: t.String({ minLength: 1 }) }),
  })
  .post("/api/echo", ({ body }) => ({ message: body.message }), {
    body: t.Object({ message: t.String({ minLength: 1 }) }),
  });

export type App = typeof app;
