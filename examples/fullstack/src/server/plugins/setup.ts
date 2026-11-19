import { jobsPlugin } from "@prinpo/stack/jobs/elysia";
import { Elysia } from "@prinpo/stack/server";

import { i18n } from "../../i18n/server";
import { authHelpers } from "../auth/instance";
import { jobs } from "../jobs";
import { logging } from "./logging";

export const setupPlugin = new Elysia({ name: "stack-example:setup" })
  .use(logging)
  .use(i18n.elysia({ ORDER_CONFIRMED: 409 }))
  .use(authHelpers.elysia())
  .use(jobsPlugin(jobs));
