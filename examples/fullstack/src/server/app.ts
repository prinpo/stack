import { Elysia } from "@prinpo/stack/server";

import { logging } from "./plugins/logging";
import { environmentRoutes } from "./routes/environment";
import { errorRoutes } from "./routes/errors";
import { notebookRoutes } from "./routes/notebooks";
import { noteRoutes } from "./routes/notes";
import { queryRoutes } from "./routes/queries";

export const app = new Elysia()
  .use(logging)
  .use(errorRoutes)
  .use(notebookRoutes)
  .use(noteRoutes)
  .use(environmentRoutes)
  .use(queryRoutes);

export type App = typeof app;
