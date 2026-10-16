import { treaty } from "@prinpo/stack/client";

import type { App } from "./server/app";

export const api = treaty<App>(window.location.origin);
