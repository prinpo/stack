import { Elysia } from "@prinpo/stack/server";

import { db } from "../database";
import { notes } from "../database/schema";
import { createNoteBody } from "../validation/notes";

export const noteRoutes = new Elysia()
  .get("/api/notes", () =>
    db.query.notes.findMany({ with: { notebook: true }, orderBy: { id: "asc" } }),
  )
  .post("/api/notes", ({ body }) => db.insert(notes).values(body).returning(), {
    body: createNoteBody,
  });
