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

export type StartServerOptions<App extends AnyElysia = AnyElysia> = ServeAppPluginsOptions & {
  env?: ServerEnvOptions;
  /** Replace the default app.stop() action on SIGINT/SIGTERM. Stack owns logging and exit status. */
  onStop?: (status: number, app: App) => void | Promise<void>;
};

/** Validate configuration before importing application modules or opening a listener. */
export async function startServer<App extends AnyElysia>(
  loadApplication: () => Promise<{ app: App }>,
  { env, onStop, ...options }: StartServerOptions<App> = {},
): Promise<App> {
  const selected = process.env._SERVE_CLIENT === "0" ? { ...env, client: false as const } : env;
  const acquired = Promise.withResolvers<App | undefined>();
  let application: App | undefined;
  let stopping = false;
  const shutdown = async (status: number) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = status;
    const grace = application ? applicationJobsShutdownTimeout(application) : 30000;
    if (grace !== undefined) {
      // Unref keeps normal cleanup fast; the deadline also bounds non-cooperative handlers.
      setTimeout(
        () => process.exit(process.exitCode ?? status),
        Math.min(2_147_483_647, grace + jobsCleanupTimeoutMs),
      ).unref();
    }
    console.error(chalkStderr.red("Stopping..."));
    try {
      const app = await acquired.promise;
      if (!app) return;
      try {
        await app.server?.stop(false);
      } finally {
        try {
          await closeApplicationJobs(app);
        } finally {
          if (onStop) await onStop(status, app);
          else if (app.server) await app.stop();
        }
      }
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
      // A failed custom action must not leave the HTTP listener running.
      try {
        if (application?.server) await application.stop();
      } catch {
        /* Preserve the original shutdown failure. */
      }
    } finally {
      removeSignals();
      // Release the managed process group as soon as application cleanup completes.
      if (process.env._STACK_LOCAL_SESSION === "1" && process.connected)
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
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const config = await loadServerEnv(selected);
    if (config.mode === "production") await migrateProductionDatabase();
    const { app } = await loadApplication();
    application = app;
    acquired.resolve(app);
    if (stopping) return app;

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

    app.onStop(() => {
      if (!stopping) removeSignals();
    });
    await app.modules;
    await validateApplicationAuth(app);
    if (stopping) return app;
    await startApplicationJobs(app);
    if (stopping) return app;
    app.listen({ hostname: config.host, port: config.port });
    console.log(`API listening at ${app.server?.url}`);
    return app;
  } catch (error) {
    acquired.resolve(undefined);
    if (stopping && application) return application;
    removeSignals();
    if (application) {
      try {
        await closeApplicationJobs(application);
      } finally {
        await onStop?.(1, application);
      }
    }
    throw error;
  }
}
