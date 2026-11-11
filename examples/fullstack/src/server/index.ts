import { startServer } from "@prinpo/stack/server";

const app = await startServer(() => import("./app"), {
  onStop: async () => {
    try {
      await app.stop();
    } finally {
      const { client } = await import("./database");
      await client.close();
    }
  },
});
