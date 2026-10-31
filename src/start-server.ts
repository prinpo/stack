import type { AnyElysia } from "elysia";

import { injectClientEnv } from "./env/html";
import { type ServerEnvOptions, loadServerEnv } from "./env/server";
import { type ServeAppPluginsOptions, serveAppPlugin } from "./serve-app";

export type StartServerOptions = ServeAppPluginsOptions & {
  env?: ServerEnvOptions;
};

/** Validate configuration before importing application modules or opening a listener. */
export async function startServer<App extends AnyElysia>(
  loadApplication: () => Promise<{ app: App }>,
  { env, ...options }: StartServerOptions = {},
): Promise<App> {
  const selected = process.env._SERVE_CLIENT === "0" ? { ...env, client: false as const } : env;
  const config = await loadServerEnv(selected);
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

  await app.modules;

  app.listen({ hostname: config.host, port: config.port });
  console.log(`API listening at ${app.server?.url}`);
  return app;
}
