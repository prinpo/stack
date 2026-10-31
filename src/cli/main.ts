#!/usr/bin/env -S bun --no-env-file
import { defineCommand, runCommand, showUsage } from "citty";

import { version } from "../../package.json";

const main = defineCommand({
  meta: { name: "stack", version, description: "Application workflows for Stack" },
  args: {
    help: { type: "boolean", alias: "h", description: "Show help" },
    version: { type: "boolean", alias: "v", description: "Show version" },
  },
  subCommands: {
    dev: () => import("./lifecycle").then((module) => module.dev),
    build: () => import("./lifecycle").then((module) => module.build),
    start: () => import("./lifecycle").then((module) => module.start),
    logs: () => import("./logs").then((module) => module.default),
    env: () => import("./env").then((module) => module.default),
    doctor: () => import("./doctor").then((module) => module.default),
  },
});

try {
  if (process.platform !== "linux") throw new Error("Stack CLI currently supports Linux only.");
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") await showUsage(main);
  else if (args.length === 1 && ["--version", "-v"].includes(args[0])) console.log(version);
  else if (args[0].startsWith("-")) throw new Error(`Unknown option ${args[0]}. Use stack --help.`);
  else await runCommand(main, { rawArgs: args });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
