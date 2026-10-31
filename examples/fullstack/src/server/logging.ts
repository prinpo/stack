import { logger } from "@prinpo/stack/logger/elysia";

import { ENV } from "../env/server";

export const logging = logger({
  service: "stack-example",
  persistence: { dir: ENV.LOG_DIR },
});
