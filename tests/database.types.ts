import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import { defineConfig } from "@prinpo/stack/database";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql/sqlite";
import { expectTypeOf } from "vite-plus/test";

import { relations } from "../examples/fullstack/src/server/database/relations";
import { notes } from "../examples/fullstack/src/server/database/schema";

const db = drizzle.mock({ relations: defineRelations({ notes }) });
const rows = db.query.notes.findMany();
expectTypeOf<Awaited<typeof rows>>().toEqualTypeOf<
  { id: number; text: string; notebookId: number | null }[]
>();
expectTypeOf<InferSelectModel<typeof notes>>().toEqualTypeOf<{
  id: number;
  text: string;
  notebookId: number | null;
}>();
expectTypeOf<InferInsertModel<typeof notes>>().toEqualTypeOf<{
  id?: number;
  text: string;
  notebookId?: number | null;
}>();
db.insert(notes).values({ text: "native inference" });
// @ts-expect-error The native schema rejects an incorrectly typed note.
db.insert(notes).values({ text: 42 });

const config = defineConfig({
  dialect: "sqlite",
  schema: "./schema.ts",
  dbCredentials: { url: "sqlite://test.sqlite" },
});
expectTypeOf(config.out).toEqualTypeOf<"./migrations">();
// @ts-expect-error Stack owns the migration output directory.
defineConfig({ dialect: "sqlite", out: "./other" });
// @ts-expect-error Output is immutable after configuration, too.
config.out = "./other";
defineConfig({
  dialect: "postgresql",
  driver: "aws-data-api",
  dbCredentials: { database: "example", secretArn: "secret", resourceArn: "resource" },
});
// @ts-expect-error Retain the native dialect/driver combinations.
defineConfig({ dialect: "sqlite", driver: "aws-data-api" });

const relatedDb = drizzle.mock({ relations });
const relatedNotes = relatedDb.query.notes.findMany({ with: { notebook: true } });
expectTypeOf<Awaited<typeof relatedNotes>>().toEqualTypeOf<
  {
    id: number;
    text: string;
    notebookId: number | null;
    notebook: { id: number; name: string } | null;
  }[]
>();
