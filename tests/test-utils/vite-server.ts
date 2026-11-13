import type { ViteDevServer } from "vite";

export async function closeViteServer(server: ViteDevServer) {
  try {
    // Cancelling an active optimizer can leave Rolldown writing after close() resolves.
    // Drain its work before fixtures are removed so those writes cannot recreate them.
    await server.waitForRequestsIdle();
    for (const environment of Object.values(server.environments)) {
      const optimizer = environment.depsOptimizer;
      await optimizer?.scanProcessing;
      for (const dep of Object.values(optimizer?.metadata.discovered ?? {})) {
        await dep.processing;
      }
    }
  } finally {
    await server.close();
  }
}
