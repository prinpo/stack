import { defineCommand, showUsage } from "citty";

import { environment, profileArgs, takeOptions } from "./options";
import { runBun, tool } from "./tools";

const command = defineCommand({
  meta: { description: "View local evlog events with native selectors and filters" },
  args: {
    ...profileArgs,
    dir: { type: "string", description: "Read this directory instead of LOG_DIR" },
  },
  async run({ rawArgs }) {
    const { values, rest } = takeOptions(rawArgs, ["env", "dir"]);
    const env = {
      ...environment(typeof values.env === "string" ? values.env : undefined),
      EVLOG_TELEMETRY: "0",
    };
    const binary = tool("@evlog/cli", "evlog");
    if (rest.includes("--help") || rest.includes("-h")) {
      await showUsage(command, { meta: { name: "stack" } });
      await runBun([binary, "logs", ...rest], env);
      return;
    }
    const directory =
      typeof values.dir === "string"
        ? values.dir
        : await (await import("../env/server")).readLogDirectory(env.APP_ENV);
    await runBun([binary, "logs", "--dir", directory, ...rest], env);
  },
});

export default command;
