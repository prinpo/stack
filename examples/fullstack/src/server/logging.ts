import { logger } from "@prinpo/stack/logger/elysia";

export const logging = logger({
  service: "stack-example",
  persistence: { dir: process.env.PRINPO_LOG_DIR ?? ".evlog/logs" },
});
