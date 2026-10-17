import { serveApp } from "@prinpo/stack/server";

import { app } from "./app";

serveApp(app, {
  isProduction: process.env.NODE_ENV === "production",
});
