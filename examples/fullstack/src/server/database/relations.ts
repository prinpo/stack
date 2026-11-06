import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  notebooks: {
    notes: r.many.notes({ from: r.notebooks.id, to: r.notes.notebookId }),
  },
  notes: {
    notebook: r.one.notebooks({ from: r.notes.notebookId, to: r.notebooks.id }),
  },
}));
