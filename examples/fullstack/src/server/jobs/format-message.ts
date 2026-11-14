import { defineJob } from "@prinpo/stack/jobs";

import { formatMessageInput } from "../validation/messages";

export const formatMessage = defineJob({
  input: formatMessageInput,
  phases: ["formatting"],
  handler: async (job) => {
    await job.updateProgress({ phase: "formatting", percent: 100 });
    return { text: job.data.text.toUpperCase(), length: job.data.text.length };
  },
});
