import { cancel, intro, isCancel, log, multiselect, outro, text } from "@clack/prompts";
import { defineCommand, showUsage } from "citty";
import { spawn } from "node:child_process";
import { lstat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { stopProcessGroup } from "../processes";
import { writeProject } from "./init/project";

function validateName(name: string) {
  if (
    name.length > 214 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(name) ||
    ["node_modules", "favicon.ico"].includes(name)
  )
    return "Use a lowercase, unscoped npm package name without path separators.";
}

async function validateDestination(name: string) {
  const invalid = validateName(name);
  if (invalid) return invalid;
  try {
    await lstat(resolve(name));
    return `Destination already exists: ${name}`;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function parseOptions(rawArgs: string[]) {
  let name: string | undefined;
  let noEditor = false;
  const editors: Array<"zed" | "vscode"> = [];
  for (let index = 0; index < rawArgs.length; index++) {
    const value = rawArgs[index]!;
    if (value === "--no-editor") noEditor = true;
    else if (value === "--editor" || value.startsWith("--editor=")) {
      const editor = value === "--editor" ? rawArgs[++index] : value.slice("--editor=".length);
      if (editor !== "zed" && editor !== "vscode")
        throw new Error("Unknown editor. Use --editor zed, --editor vscode, or --no-editor.");
      if (!editors.includes(editor)) editors.push(editor);
    } else if (value.startsWith("-"))
      throw new Error(`Unknown option ${value}. Use stack init --help.`);
    else if (name) throw new Error("Supply one project name. Use stack init --help.");
    else name = value;
  }
  if (noEditor && editors.length) throw new Error("--editor and --no-editor cannot be combined.");
  return { name, editors, editorSpecified: noEditor || editors.length > 0 };
}

const command = defineCommand({
  meta: { description: "Initialize a Stack project with a TanStack Router frontend" },
  args: {
    name: {
      type: "positional",
      required: false,
      description: "New project directory and package name",
    },
    editor: { type: "string", description: "Generate zed or vscode settings; repeat for both" },
    "no-editor": { type: "boolean", description: "Skip editor settings" },
  },
  async run({ rawArgs }) {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await showUsage(command, { meta: { name: "stack" } });
      return;
    }
    const options = parseOptions(rawArgs);
    const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
    if (options.name) {
      const invalid = await validateDestination(options.name);
      if (invalid) throw new Error(invalid);
    } else {
      if (!interactive)
        throw new Error("A project name is required. Use stack init my-app --no-editor.");
      intro("Create a Stack project");
      const name = await text({
        message: "Project name",
        validate: async (value) => validateDestination(value ?? ""),
      });
      if (isCancel(name)) {
        cancel("Initialization cancelled.");
        process.exitCode = 130;
        return;
      }
      options.name = name;
    }
    if (interactive && !options.editorSpecified) {
      const editors = await multiselect({
        message: "Editors (Space to select, Enter to continue; leave empty to skip)",
        options: [
          { value: "zed" as const, label: "Zed" },
          { value: "vscode" as const, label: "VS Code" },
        ],
        initialValues: [],
        required: false,
      });
      if (isCancel(editors)) {
        cancel("Initialization cancelled.");
        process.exitCode = 130;
        return;
      }
      options.editors = editors;
    }
    if (!Bun.which("git"))
      throw new Error("Git is required to initialize a project. Install Git and retry.");
    const directory = resolve(options.name);
    // Exclusive creation also protects against a destination appearing during prompting.
    await mkdir(directory);
    let recovery = "bun install";
    try {
      await writeProject(directory, options.name, options.editors);
      recovery = "git init --initial-branch=main";
      await runStep("Initialize Git on main", "git", ["init", "--initial-branch=main"], directory);
      recovery = "bun install";
      await runStep(
        "Install dependencies and configure hooks",
        process.execPath,
        ["install"],
        directory,
      );
      recovery = "bun run fmt && bun run check";
      await runStep("Format project files", process.execPath, ["--bun", "vp", "fmt"], directory);
      recovery = "bun run check";
      await runStep(
        "Check formatting, lint and types",
        process.execPath,
        ["run", "check"],
        directory,
      );
      recovery = "bun run test";
      await runStep("Run tests", process.execPath, ["run", "test"], directory);
      outro(`Ready: ${directory}\nRun bun run dev from the project directory.`);
    } catch (error) {
      const quoted = "'" + directory.replaceAll("'", "'\\''") + "'";
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nProject retained at ${directory}.\nRecover: cd ${quoted} && ${recovery}\nThen run bun install, bun run fmt, bun run check, and bun run test.`,
      );
    }
  },
});

export default command;

async function runStep(label: string, executable: string, args: string[], cwd: string) {
  log.step(label);
  const child = spawn(executable, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    detached: true,
  });
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void stopProcessGroup(child, "SIGINT");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const status = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    if (interrupted) {
      process.exitCode = 130;
      throw new Error(`${label} cancelled.`);
    }
    if (status !== 0) throw new Error(`${label} failed (exit ${status ?? "signal"}).`);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
