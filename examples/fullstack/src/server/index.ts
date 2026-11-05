import { startServer } from "@prinpo/stack/server";

const app = await startServer(() => import("./app"));

// Native Elysia stop hooks close the application-owned database client.
for (const [signal, status] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, async () => {
    try {
      await app.stop();
      process.exitCode = status;
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}
