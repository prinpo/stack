import { startServer } from "@prinpo/stack/server";

await startServer(() => import("./app"));
