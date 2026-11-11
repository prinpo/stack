import { defineCommand, showUsage } from "citty";

import { databaseConfig, isFile } from "../database/files";
import { runKit } from "../database/kit";
import { serverEnvPaths } from "../env/paths";
import { loadServerEnv, loadStaticEnv } from "../env/server";
import { environment, profileArgs, takeOptions } from "./options";

const operations = [
  "generate",
  "migrate",
  "push",
  "pull",
  "studio",
  "check",
  "up",
  "export",
] as const;
const connected = new Set(["migrate", "push", "pull", "studio"]);

function operation(name: (typeof operations)[number]) {
  return defineCommand({
    meta: { name, description: `Native Drizzle Kit ${name}` },
    args: profileArgs,
    async run({ rawArgs }) {
      const { values, rest } = takeOptions(rawArgs, ["env"]);
      const env: NodeJS.ProcessEnv = environment(
        typeof values.env === "string" ? values.env : undefined,
      );
      const help = rest.includes("--help") || rest.includes("-h");
      if (!help) {
        if (rest.some((arg) => arg === "--out" || arg.startsWith("--out=")))
          throw new Error(
            "Stack owns the migration directory. Remove --out; migrations always use ./migrations.",
          );
        if (!isFile(databaseConfig))
          throw new Error(
            `Missing ${databaseConfig}. Add native Drizzle configuration to enable the Database Block.`,
          );
        if (connected.has(name)) {
          Object.assign(process.env, env);
          await loadServerEnv({ client: false });
          Object.assign(env, process.env);
        } else {
          const graph = await loadStaticEnv(serverEnvPaths(), {
            values: env,
            profile: env.APP_ENV,
          });
          env.__VARLOCK_ENV = JSON.stringify(graph);
        }
      }
      // Native help must not initialize Varlock or require configuration.
      if (help) {
        const { runBun, tool } = await import("./tools");
        await runBun([tool("drizzle-kit", "drizzle-kit"), name, ...rest], env);
      } else await runKit([name, ...rest], env);
    },
  });
}

const command = defineCommand({
  meta: { name: "db", description: "Native Drizzle workflows for the application database" },
  subCommands: Object.fromEntries(operations.map((name) => [name, operation(name)])),
  async run({ rawArgs }) {
    if (!rawArgs.length || rawArgs[0] === "--help" || rawArgs[0] === "-h")
      await showUsage(command, { meta: { name: "stack" } });
  },
});
export default command;
