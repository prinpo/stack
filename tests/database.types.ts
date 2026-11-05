import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql/sqlite";
import { expectTypeOf } from "vite-plus/test";

import { notes } from "../examples/fullstack/src/server/database/schema";

const db = drizzle.mock({ relations: defineRelations({ notes }) });
const rows = db.query.notes.findMany();
expectTypeOf<Awaited<typeof rows>>().toEqualTypeOf<{ id: number; text: string }[]>();
expectTypeOf<InferSelectModel<typeof notes>>().toEqualTypeOf<{ id: number; text: string }>();
expectTypeOf<InferInsertModel<typeof notes>>().toEqualTypeOf<{ id?: number; text: string }>();
db.insert(notes).values({ text: "native inference" });
// @ts-expect-error The native schema rejects an incorrectly typed note.
db.insert(notes).values({ text: 42 });
