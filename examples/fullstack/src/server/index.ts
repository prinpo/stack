import { serveApp } from "@prinpo/stack/server";
import "@prinpo/stack/env/auto-load";

import { ENV } from "../env/server";
import { app } from "./app";

serveApp(app, {
  isProduction: ENV.NODE_ENV === "production",
  port: ENV.PORT,
});
