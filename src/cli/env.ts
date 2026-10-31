import { defineCommand, showUsage } from "citty";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { serverEnvPaths } from "../env/paths";
import { environment, profileArgs, takeOptions } from "./options";
import { absolute } from "./project";
import { runBun, tool } from "./tools";

function nativeCommand(operation: "load" | "codegen" | "run") {
  const command = defineCommand({
    meta: { name: operation, description: `Varlock ${operation} with Stack's schema defaults` },
    args: {
      ...profileArgs,
      client: { type: "boolean", description: "Select the client schema" },
      server: { type: "boolean", description: "Select the server schema" },
    },
    async run({ rawArgs }) {
      const { values, rest } = takeOptions(rawArgs, ["env"], ["client", "server"]);
      if (values.client && values.server) throw new Error("Select either --client or --server.");
      const env = environment(typeof values.env === "string" ? values.env : undefined);
      const binary = tool("varlock", "varlock");
      const boundary = rest.indexOf("--");
      const options = boundary < 0 ? rest : rest.slice(0, boundary);
      if (options.includes("--help") || options.includes("-h")) {
        await showUsage(command, { meta: { name: "stack env" } });
        await runBun([binary, operation, ...rest], env);
        return;
      }
      const selected = values.client ? "client" : values.server ? "server" : undefined;
      if (selected && !existsSync(`env/${selected}`))
        throw new Error(`Selected schema does not exist: env/${selected}`);
      const extra =
        parseArgs({
          args: options,
          options: { path: { type: "string", short: "p", multiple: true } },
          strict: false,
          allowPositionals: true,
        }).values.path ?? [];
      const validateClient = async () => {
        const { validateClientEnv } = await import("../env/server");
        await validateClientEnv(
          [absolute("env/client"), ...extra.filter((path) => typeof path === "string")],
          env.APP_ENV,
        );
      };
      if (operation === "codegen") {
        for (const area of selected ? [selected] : ["client", "server"])
          if (existsSync(`env/${area}`)) {
            if (area === "client") await validateClient();
            const paths = area === "server" ? serverEnvPaths() : [absolute("env/client")];
            await runBun(
              [binary, operation, ...paths.flatMap((path) => ["--path", path]), ...rest],
              env,
            );
          }
      } else {
        if (selected === "client") await validateClient();
        const paths = selected === "client" ? [absolute("env/client")] : serverEnvPaths();
        await runBun(
          [binary, operation, ...paths.flatMap((path) => ["--path", path]), ...rest],
          env,
        );
      }
    },
  });
  return command;
}

const command = defineCommand({
  meta: { name: "env", description: "Load, generate, or run with validated configuration" },
  subCommands: {
    load: nativeCommand("load"),
    codegen: nativeCommand("codegen"),
    run: nativeCommand("run"),
  },
  async run({ rawArgs }) {
    if (rawArgs.length === 0 || rawArgs[0] === "--help" || rawArgs[0] === "-h")
      await showUsage(command, { meta: { name: "stack" } });
  },
});
export default command;
