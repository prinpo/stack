import type { ChildProcess } from "node:child_process";

import { defineCommand, showUsage } from "citty";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { serverEnvPaths } from "../env/paths";
import { environment, profileArgs, takeOptions } from "./options";
import { type Area, type BuildResult, buildSummary, heading, intro } from "./output";
import { capabilities, isFile, outputs } from "./project";
import { runBun, spawnBun, stop, tool } from "./tools";

function lifecycleCommand(
  name: string,
  description: string,
  action: (env: NodeJS.ProcessEnv) => Promise<void>,
) {
  const command = defineCommand({
    meta: { name, description },
    args: profileArgs,
    async run({ rawArgs }) {
      if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        await showUsage(command, { meta: { name: "stack" } });
        return;
      }
      const { values, rest } = takeOptions(rawArgs, ["env"]);
      if (rest.length) throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
      await action(
        environment(
          typeof values.env === "string" ? values.env : undefined,
          name === "dev" ? "development" : "production",
        ),
      );
    },
  });
  return command;
}

async function outputSize(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? outputSize(path) : entry.isFile() ? (await stat(path)).size : 0;
    }),
  );
  return sizes.reduce((total, bytes) => total + bytes, 0);
}

export const build = lifecycleCommand(
  "build",
  "Build detected capabilities without deployment credentials",
  async (env) => {
    const started = performance.now();
    intro("build", env.APP_ENV);
    await rm(outputs.manifest, { force: true });
    const app = capabilities();
    const results: BuildResult[] = [];
    await Promise.all(
      [outputs.client, outputs.server].map((path) => rm(path, { recursive: true, force: true })),
    );
    if (app.frontend) {
      const frontendStarted = performance.now();
      heading("frontend", "Building browser assets");
      if (existsSync("env/client"))
        await runBun(
          [tool("varlock", "varlock"), "load", "--path", "env/client", "--format", "json-full"],
          { ...env, _VARLOCK_STATIC_ONLY: "1", _VARLOCK_PUBLIC_ONLY: "1" },
          "ignore",
          "frontend",
        );
      await runBun(
        [tool("vite-plus", "vp"), "build", "--outDir", outputs.client, "--configLoader", "runner"],
        env,
        "inherit",
        "frontend",
      );
      const milliseconds = performance.now() - frontendStarted;
      results.push({
        area: "frontend",
        directory: outputs.client,
        milliseconds,
        bytes: await outputSize(outputs.client),
      });
    }
    if (app.backend) {
      const backendStarted = performance.now();
      heading("backend", "Building Bun server");
      await runBun(
        [
          tool("varlock", "varlock"),
          "load",
          ...serverEnvPaths().flatMap((path) => ["--path", path]),
          "--format",
          "json-full",
        ],
        { ...env, _VARLOCK_STATIC_ONLY: "1" },
        "ignore",
        "backend",
      );
      await runBun(
        [
          "build",
          "--target",
          "bun",
          "--packages",
          "external",
          "src/server/index.ts",
          "--outdir",
          outputs.server,
        ],
        env,
        "inherit",
        "backend",
      );
      const milliseconds = performance.now() - backendStarted;
      results.push({
        area: "backend",
        directory: outputs.server,
        milliseconds,
        bytes: await outputSize(outputs.server),
      });
    }
    await mkdir("dist", { recursive: true });
    await writeFile(outputs.manifest, JSON.stringify({ version: 1, ...app }) + "\n");
    buildSummary(results, performance.now() - started, env.APP_ENV ?? "production");
  },
);

export const start = lifecycleCommand(
  "start",
  "Start the successful build with runtime configuration",
  async (env) => {
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(outputs.manifest, "utf8"));
    } catch {
      throw new Error("Missing or invalid dist/manifest.json. Run stack build before starting.");
    }
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("version" in manifest) ||
      manifest.version !== 1 ||
      !("frontend" in manifest) ||
      typeof manifest.frontend !== "boolean" ||
      !("backend" in manifest) ||
      typeof manifest.backend !== "boolean" ||
      (!manifest.frontend && !manifest.backend)
    )
      throw new Error("Invalid build manifest. Run stack build before starting.");
    for (const [enabled, path] of [
      [manifest.frontend, `${outputs.client}/index.html`],
      [manifest.backend, outputs.entry],
    ] as const)
      if (enabled && !isFile(path))
        throw new Error(`Build artifact missing or invalid: ${path}. Run stack build.`);
    const entry = manifest.backend
      ? outputs.entry
      : fileURLToPath(new URL("../start-frontend.ts", import.meta.url));
    const startup = { ...env, _SERVE_CLIENT: manifest.frontend ? "1" : "0" };
    const inherited = Object.fromEntries(
      Object.entries(startup).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    process.execve!(process.execPath, [process.execPath, "--no-env-file", entry], inherited);
  },
);

export const dev = lifecycleCommand(
  "dev",
  "Run detected capabilities with native code watching",
  async (env) => {
    const app = capabilities();
    intro("dev", env.APP_ENV);
    const commands: { area: Area; args: string[] }[] = [];
    if (app.backend)
      commands.push({
        area: "backend",
        args: ["--watch", "--no-clear-screen", "src/server/index.ts"],
      });
    if (app.frontend)
      commands.push({
        area: "frontend",
        args: [
          tool("vite-plus", "vp"),
          "dev",
          "--configLoader",
          "runner",
          "--strictPort",
          "--clearScreen",
          "false",
        ],
      });
    let children: ChildProcess[] = [];
    let closing = false;
    let finish!: (status: number) => void;
    const completed = new Promise<number>((done) => {
      finish = done;
    });
    const close = (status: number) => {
      if (!closing) {
        closing = true;
        finish(status);
      }
    };
    const launch = () => {
      for (const command of commands) {
        const child = spawnBun(command.args, env, "inherit", command.area);
        children.push(child);
        child.once("error", (error) => {
          console.error(error.message);
          close(1);
        });
        child.once("exit", (code) => {
          if (children.includes(child)) close(code || 1);
        });
      }
    };
    const interrupt = () => close(130);
    const terminate = () => close(143);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    let restarting = Promise.resolve();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const watcher =
      app.backend && existsSync("env/server")
        ? watch("env/server", { recursive: true }, () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              restarting = restarting
                .then(async () => {
                  const previous = children;
                  children = [];
                  await Promise.all(previous.map(stop));
                  if (!closing) {
                    console.error("Environment changed; restarting development session.");
                    launch();
                  }
                })
                .catch((error) => {
                  console.error(error);
                  close(1);
                });
            }, 100);
          })
        : undefined;
    watcher?.on("error", (error) => {
      console.error(error.message);
      close(1);
    });
    try {
      launch();
      const status = await completed;
      process.exitCode = status;
    } finally {
      clearTimeout(debounce);
      watcher?.close();
      await restarting;
      await Promise.all(children.map(stop));
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  },
);
