import { startJobsWorker } from "@prinpo/stack/jobs";

await startJobsWorker(() => import("./jobs"));
