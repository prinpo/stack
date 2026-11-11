import { createInsertSchema } from "@prinpo/stack/database/zod";

import { notebooks } from "./database/schema";

// Start from the table shape, add API rules, and allow only caller-owned fields.
export const createNotebookBody = createInsertSchema(notebooks, {
  name: (schema) => schema.trim().min(1).max(100),
}).pick({ name: true });
