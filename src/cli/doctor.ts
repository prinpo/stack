import { defineCommand, showUsage } from "citty";

import { color, intro } from "./output";
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
      section("Application capabilities", [
        { label: "Frontend", present: project.frontend.enabled, detail: project.frontend.reason },
        { label: "Backend", present: project.backend.enabled, detail: project.backend.reason },
      ]);
      section(
        "Environment schemas",
        (["client", "server"] as const).map((area) => ({
          label: area === "client" ? "Client" : "Server",
          present: project.env[area],
          detail: `env/${area}${project.env[area] ? "" : " not found; defaults apply"}`,
        })),
      );
      section("Development dependencies", [
        {
          label: "Docker Compose",
          present: project.compose.enabled,
          detail: project.compose.reason,
        },
      ]);
      section("Database", [
        {
          label: "Drizzle",
          present: project.database.enabled,
          error: !project.database.ready,
          detail:
            project.database.enabled && project.database.ready
              ? `${project.database.reason} in ${project.database.directory}/`
              : project.database.reason,
        },
      ]);
      if (!project.frontend.enabled && !project.backend.enabled)
        console.log(color.red("No application detected. Add index.html or src/server/index.ts."));
    }
    if ((!project.frontend.enabled && !project.backend.enabled) || !project.database.ready)
      process.exitCode = 1;
  },
});

function section(
  title: string,
  rows: { label: string; present: boolean; detail: string; error?: boolean }[],
) {
  console.log(`\n${color.bold(title)}`);
  for (const row of rows) {
    const mark = row.error ? color.red("!") : row.present ? color.green("✓") : color.dim("○");
    console.log(`  ${mark} ${row.label}`);
    console.log(color.dim(`    ${row.detail}`));
  }
}

export default command;
