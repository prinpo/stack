import { ENV } from "../../env-gen/server";
import utilities from "./queues/utilities";

export const queues = { utilities };
export const jobs = {
  queues,
  connection: { url: ENV.JOBS_REDIS_URL },
  prefix: `stack-example:${ENV.APP_ENV}`,
};
