import { integer, sqliteTable, text } from "@prinpo/stack/database/sqlite-core";

export const notebooks = sqliteTable("notebooks", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
});

export const notes = sqliteTable("notes", {
  id: integer().primaryKey({ autoIncrement: true }),
  text: text().notNull(),
  notebookId: integer().references(() => notebooks.id),
});

/** Business operation results outlive BullMQ's completed-job retention. */
export const jobResults = sqliteTable("job_results", {
  operationId: text().primaryKey(),
  text: text().notNull(),
  length: integer().notNull(),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
});
