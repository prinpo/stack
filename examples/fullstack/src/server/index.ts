import { startServer } from "@prinpo/stack/server";

await startServer(() => import("./app"), {
  onStop: async (_status, app) => {
    try {
      if (app.server) await app.stop();
    } finally {
      const { client } = await import("./database");
      await client.close();
    }
  },
});
