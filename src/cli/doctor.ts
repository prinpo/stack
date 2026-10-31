import { defineCommand, showUsage } from "citty";

import { inspectProject } from "./project";

const command = defineCommand({
  meta: { description: "Explain the detected application structure" },
  args: { json: { type: "boolean", description: "Output JSON for agents" } },
  async run({ args, rawArgs }) {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await showUsage(command, { meta: { name: "stack" } });
      return;
    }
    const project = inspectProject();
    if (args.json) console.log(JSON.stringify(project));
    else {
      for (const area of ["frontend", "backend"] as const) {
        const item = project[area];
        console.log(`${area}: ${item.enabled ? "enabled" : "disabled"} — ${item.reason}`);
      }
      for (const area of ["client", "server"] as const)
        console.log(
          `${area} env: ${project.env[area] ? `found env/${area}` : "absent — defaults apply"}`,
        );
    }
    if (!project.frontend.enabled && !project.backend.enabled) process.exitCode = 1;
  },
});

export default command;
