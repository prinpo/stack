import { defineCommand, showUsage } from "citty";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { authConfig, authSchema } from "../auth/files";
import { serverEnvPaths } from "../env/paths";
import { loadStaticEnv } from "../env/server";
import { environment, profileArgs, takeOptions } from "./options";
import { runBun } from "./tools";

function operation(name: "generate" | "check" | "info") {
  const command = defineCommand({
    meta: {
      name,
      description:
        name === "generate"
          ? "Generate native Drizzle auth schema without connecting"
          : name === "check"
            ? "Check configured auth schema against native generation"
            : "Describe auth configuration without credentials",
    },
    args: {
      ...profileArgs,
      config: { type: "string", description: `Auth configuration (default ${authConfig})` },
      output: { type: "string", description: `Generated schema (default ${authSchema})` },
      yes: { type: "boolean", description: "Allow replacing generated output" },
    },
    async run({ args, rawArgs }) {
      if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        await showUsage(command, { meta: { name: "stack auth" } });
        return;
      }
      const { values, rest } = takeOptions(rawArgs, ["env", "config", "output"], ["yes"]);
      if (rest.length) throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
      const env = environment(typeof values.env === "string" ? values.env : undefined);
      const graph = await loadStaticEnv(serverEnvPaths(), { values: env, profile: env.APP_ENV });
      await runBun(
        [
          fileURLToPath(new URL("./auth-schema.ts", import.meta.url)),
          name,
          args.config ?? authConfig,
          args.output ?? authSchema,
          args.yes ? "yes" : "no",
        ],
        { ...env, __VARLOCK_ENV: JSON.stringify(graph), BETTER_AUTH_TELEMETRY: "0" },
      );
    },
  });
  return command;
}
const command = defineCommand({
  meta: { name: "auth", description: "Auth schema, checks, diagnostics, and secrets" },
  subCommands: {
    generate: operation("generate"),
    check: operation("check"),
    info: operation("info"),
    secret: defineCommand({
      meta: { description: "Generate a secret without loading application configuration" },
      run() {
        console.log(randomBytes(32).toString("base64url"));
      },
    }),
  },
  async run({ rawArgs }) {
    if (!rawArgs.length || rawArgs.includes("--help") || rawArgs.includes("-h"))
      await showUsage(command, { meta: { name: "stack" } });
  },
});
export default command;
