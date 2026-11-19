import { eq } from "@prinpo/stack/database";
import { withStoredResult } from "@prinpo/stack/jobs";

import { jobResults } from "../../../database/schema";
import { saveMessageInput } from "../../../validation/messages";
import { appJob } from "../../context";

export const saveMessage = appJob({
  input: saveMessageInput,
  handler: async (job, { db, logger }) => {
    const { operationId, text: message } = job.data;
    logger.set({ operationId });
    const load = async () => {
      const [row] = await db
        .select()
        .from(jobResults)
        .where(eq(jobResults.operationId, operationId));
      if (!row) return undefined;
      const { text, length, createdAt } = row;
      return { result: { text, length, createdAt } };
    };
    return withStoredResult({
      load,
      run: async () => {
        const text = message.toUpperCase();
        return { text, length: text.length, createdAt: new Date() };
      },
      save: async (result) => {
        await db
          .insert(jobResults)
          .values({ operationId, ...result })
          .onConflictDoNothing();
        // On a competing writer, return the committed canonical result.
        return (await load())!.result;
      },
    });
  },
});
