import { z } from "@prinpo/stack/jobs";

export const formatMessageInput = z.object({ text: z.string().trim().min(1).max(1000) });
