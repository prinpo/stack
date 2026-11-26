import { defineCommand, showUsage } from "citty";

import { runComposeOperation } from "./compose";
import { takeOptions } from "./options";

function operation(name: "up" | "down", description: string) {
  const command = defineCommand({
    meta: { name, description },
    args: {
      profile: {
        type: "string",
        description: "Local Compose project (development by default, or preview)",
      },
    },
    async run({ rawArgs }) {
      if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        await showUsage(command, { meta: { name: "stack docker" } });
        return;
      }
      const { values, rest } = takeOptions(rawArgs, ["profile"]);
      if (rest.length) throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
      const profile = values.profile ?? "development";
      if (profile !== "development" && profile !== "preview")
        throw new Error(
          `Unknown Compose profile ${JSON.stringify(profile)}. Use development or preview.`,
        );

      const cancellation = new AbortController();
      const interrupt = () => cancellation.abort(130);
      const terminate = () => cancellation.abort(143);
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
      try {
        const status = await runComposeOperation(
          profile === "development" ? "dev" : "preview",
          name,
          cancellation.signal,
        );
        if (status) process.exitCode = status;
      } finally {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
      }
    },
  });
  return command;
}

const command = defineCommand({
  meta: { name: "docker", description: "Start and stop local Compose dependencies" },
  subCommands: {
    up: operation("up", "Start Compose services and wait for readiness"),
    down: operation("down", "Stop Compose services and preserve containers and volumes"),
  },
  async run({ rawArgs }) {
    if (!rawArgs.length || rawArgs[0] === "--help" || rawArgs[0] === "-h")
      await showUsage(command, { meta: { name: "stack" } });
  },
});

export default command;
