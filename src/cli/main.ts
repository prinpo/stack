#!/usr/bin/env -S bun --no-env-file
import { defineCommand, renderUsage, runCommand } from "citty";

import { version } from "../../package.json";
import { intro } from "./output";

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
    auth: () => import("./auth").then((module) => module.default),
    db: () => import("./database").then((module) => module.default),
  },
});

try {
  if (process.platform !== "linux") throw new Error("Stack CLI currently supports Linux only.");
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    intro();
    const usage = await renderUsage(main);
    // Replace citty's first paragraph with the shared Stack branding.
    console.log(usage.slice(usage.indexOf("\n\n") + 2));
  } else if (args.length === 1 && ["--version", "-v"].includes(args[0])) console.log(version);
  else if (args[0].startsWith("-")) throw new Error(`Unknown option ${args[0]}. Use stack --help.`);
  else await runCommand(main, { rawArgs: args });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode ||= 1;
}
