import { z } from "@prinpo/stack/jobs";

export const formatMessageInput = z.object({ text: z.string().trim().min(1).max(1000) });

export const saveMessageInput = z.object({ operationId: z.uuid(), text: z.string().trim().min(1) });
