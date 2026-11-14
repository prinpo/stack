import { Elysia } from "@prinpo/stack/server";

import { db } from "../database";
import { notes } from "../database/schema";
import { setupPlugin } from "../plugins/setup";
import { createNoteBody } from "../validation/notes";

export const noteRoutes = new Elysia()
  .use(setupPlugin)
  .get("/api/notes", () =>
    db.query.notes.findMany({ with: { notebook: true }, orderBy: { id: "asc" } }),
  )
  .post("/api/notes", ({ body }) => db.insert(notes).values(body).returning(), {
    body: createNoteBody,
  });
