import { openapi } from "@prinpo/stack/openapi";
import { Elysia } from "@prinpo/stack/server";

import { setupPlugin } from "./plugins/setup";
import { environmentRoutes } from "./routes/environment";
import { errorRoutes } from "./routes/errors";
import { jobRoutes } from "./routes/jobs";
import { notebookRoutes } from "./routes/notebooks";
import { noteRoutes } from "./routes/notes";
import { queryRoutes } from "./routes/queries";

export const app = new Elysia()
  .use(openapi())
  .use(setupPlugin)
  .get("/api/profile", ({ user, session }) => ({ user, session }), { auth: true })
  .use(errorRoutes)
  .use(jobRoutes)
  .use(notebookRoutes)
  .use(noteRoutes)
  .use(environmentRoutes)
  .use(queryRoutes);

export type App = typeof app;
