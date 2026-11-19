import { defineCommand, showUsage } from "citty";

import { color, intro } from "./output";
import { inspectProject } from "./project";

const command = defineCommand({
  meta: { description: "Explain the detected application structure" },
  args: {
    json: { type: "boolean", description: "Output JSON for agents" },
    "auth-config": { type: "string", description: "Custom auth config path" },
    "auth-schema": { type: "string", description: "Custom generated auth schema path" },
  },
  async run({ args, rawArgs }) {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await showUsage(command, { meta: { name: "stack" } });
      return;
    }
    const project = inspectProject({ config: args["auth-config"], schema: args["auth-schema"] });
    if (args.json) console.log(JSON.stringify(project));
    else {
      intro("doctor");
      section("Application capabilities", [
        {
          label: "Frontend",
          present: project.frontend.enabled,
          error: !project.frontend.ready,
          detail: project.frontend.reason,
        },
        { label: "Worker", present: project.worker.enabled, detail: project.worker.reason },
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
      section("Local dependencies", [
        {
          label: "Development Compose",
          present: project.compose.enabled,
          detail: project.compose.reason,
        },
        {
          label: "Preview Compose",
          present: project.previewCompose.enabled,
          detail: project.previewCompose.reason,
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
      section("Authentication", [
        {
          label: "Better Auth",
          present: project.auth.enabled,
          error: !project.auth.ready,
          detail: project.auth.reason,
        },
      ]);
      section("Internationalization", [
        {
          label: "General Translation",
          present: project.i18n.enabled,
          error: !project.i18n.ready,
          detail: project.i18n.defaultLocale
            ? project.i18n.locales
                .map((locale) =>
                  locale === project.i18n.defaultLocale ? `${locale} (default)` : locale,
                )
                .join(", ")
            : project.i18n.reason,
        },
      ]);
      if (!project.frontend.enabled && !project.backend.enabled && !project.worker.enabled)
        console.log(
          color.red(
            "No application detected. Add src/index.html, src/server/index.ts, or src/server/worker.ts.",
          ),
        );
    }
    if (
      (!project.frontend.enabled && !project.backend.enabled && !project.worker.enabled) ||
      !project.frontend.ready ||
      !project.database.ready ||
      !project.auth.ready ||
      !project.i18n.ready
    )
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
