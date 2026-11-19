import { formatMessageInput } from "../../../validation/messages";
import { appJob } from "../../context";

export const formatMessage = appJob({
  input: formatMessageInput,
  phases: ["formatting"],
  handler: async (job) => {
    await job.updateProgress({ phase: "formatting", percent: 100 });
    return { text: job.data.text.toUpperCase(), length: job.data.text.length };
  },
});
