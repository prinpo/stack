import { t } from "@prinpo/stack/server";

export const createNoteBody = t.Object({
  text: t.String({ minLength: 1, maxLength: 500 }),
  notebookId: t.Optional(t.Integer({ minimum: 1 })),
});
