import { Elysia } from "@prinpo/stack/server";

import { db } from "../database";
import { notebooks } from "../database/schema";
import { createNotebookBody } from "../validation/notebooks";

export const notebookRoutes = new Elysia()
  .get("/api/notebooks", () =>
    db.query.notebooks.findMany({ with: { notes: true }, orderBy: { id: "asc" } }),
  )
  .post("/api/notebooks", ({ body }) => db.insert(notebooks).values(body).returning(), {
    body: createNotebookBody,
  });
