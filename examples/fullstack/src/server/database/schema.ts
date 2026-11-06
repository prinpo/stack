import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const notebooks = sqliteTable("notebooks", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
});

export const notes = sqliteTable("notes", {
  id: integer().primaryKey({ autoIncrement: true }),
  text: text().notNull(),
  notebookId: integer().references(() => notebooks.id),
});
