import type { AnyElysia } from "elysia";

import { chalkStderr } from "chalk";

import { validateApplicationAuth } from "./auth/startup";
import { migrateProductionDatabase } from "./database/startup";
import { injectClientEnv } from "./env/html";
import { type ServerEnvOptions, loadServerEnv } from "./env/server";
import {
  applicationJobsShutdownTimeout,
  closeApplicationJobs,
  jobsCleanupTimeoutMs,
  startApplicationJobs,
} from "./jobs/lifecycle";
import { type ServeAppPluginsOptions, serveAppPlugin } from "./serve-app";

export type StartServerOptions = ServeAppPluginsOptions & {
  env?: ServerEnvOptions;
  /** Replace the default app.stop() action on SIGINT/SIGTERM. Stack owns logging and exit status. */
  onStop?: (status: number) => void | Promise<void>;
};

/** Validate configuration before importing application modules or opening a listener. */
export async function startServer<App extends AnyElysia>(
  loadApplication: () => Promise<{ app: App }>,
  { env, onStop, ...options }: StartServerOptions = {},
): Promise<App> {
  const selected = process.env._SERVE_CLIENT === "0" ? { ...env, client: false as const } : env;
  const config = await loadServerEnv(selected);
  if (config.mode === "production") await migrateProductionDatabase();
  const { app } = await loadApplication();

  if (config.mode === "production" && selected?.client !== false) {
    const custom = options.transformIndexHtml;
    app.use(
      await serveAppPlugin({
        ...options,
        transformIndexHtml: async (html) =>
          injectClientEnv(
            custom ? await custom(html) : html,
            config.clientValues,
            config.clientKeys,
          ),
      }),
    );
  }

  let stopping = false;
  const shutdown = async (status: number) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = status;
    const grace = applicationJobsShutdownTimeout(app);
    if (grace !== undefined) {
      // Unref keeps normal cleanup fast; the deadline also bounds non-cooperative handlers.
      setTimeout(
        () => process.exit(process.exitCode ?? status),
        Math.min(2_147_483_647, grace + jobsCleanupTimeoutMs),
      ).unref();
    }
    console.error(chalkStderr.red("Stopping..."));
    try {
      await closeApplicationJobs(app);
      if (onStop) await onStop(status);
      else await app.stop();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
      // A failed custom action must not leave the HTTP listener running.
      try {
        await app.stop();
      } catch {
        /* Preserve the original shutdown failure. */
      }
    } finally {
      removeSignals();
      // Bun's code watcher can outlive the app. Tell the managed session cleanup is complete.
      if (process.env._STACK_BROWSER_LOG_IPC === "1" && process.connected)
        process.send?.({ type: "stack:shutdown-complete" }, () => {});
    }
  };
  const interrupt = () => {
    void shutdown(130);
  };
  const terminate = () => {
    void shutdown(143);
  };
  const removeSignals = () => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  };
  app.onStop(() => {
    if (!stopping) removeSignals();
  });
  await app.modules;
  try {
    await validateApplicationAuth(app);
    await startApplicationJobs(app);
    app.listen({ hostname: config.host, port: config.port });
  } catch (error) {
    await closeApplicationJobs(app);
    throw error;
  }
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  console.log(`API listening at ${app.server?.url}`);
  return app;
}
