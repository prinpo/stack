import { defineCommand, showUsage } from "citty";

import { areaPresentation, color, intro } from "./output";
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
      intro("doctor");
      console.log(`\n${color.bold("Application capabilities")}`);
      for (const area of ["frontend", "backend"] as const) {
        const item = project[area];
        const { title, style } = areaPresentation(area);
        const label = style(title.padEnd(10));
        const status = item.enabled ? color.green("✓ enabled") : color.yellow("○ disabled");
        console.log(`  ${label}${status}`);
        console.log(color.dim(`    ${item.reason}`));
      }
      console.log(`\n${color.bold("Environment schemas")}`);
      for (const area of ["client", "server"] as const)
        console.log(
          `  ${project.env[area] ? color.green("✓") : color.dim("○")} env/${area} ${color.dim(project.env[area] ? "found" : "absent — defaults apply")}`,
        );
      console.log();
      if (!project.frontend.enabled && !project.backend.enabled)
        console.log(color.red("No application detected. Add index.html or src/server/index.ts."));
    }
    if (!project.frontend.enabled && !project.backend.enabled) process.exitCode = 1;
  },
});

export default command;
