import type { ChildProcess } from "node:child_process";

import { defineCommand, showUsage } from "citty";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { serverEnvPaths } from "../env/paths";
import { environment, profileArgs, takeOptions } from "./options";
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

export const build = lifecycleCommand(
  "build",
  "Build detected capabilities without deployment credentials",
  async (env) => {
    await rm(outputs.manifest, { force: true });
    const app = capabilities();
    await Promise.all(
      [outputs.client, outputs.server].map((path) => rm(path, { recursive: true, force: true })),
    );
    if (app.frontend && existsSync("env/client"))
      await runBun(
        [tool("varlock", "varlock"), "load", "--path", "env/client", "--format", "json-full"],
        { ...env, _VARLOCK_STATIC_ONLY: "1", _VARLOCK_PUBLIC_ONLY: "1" },
        "ignore",
      );
    if (app.frontend)
      await runBun(
        [tool("vite-plus", "vp"), "build", "--outDir", outputs.client, "--configLoader", "runner"],
        env,
      );
    if (app.backend) {
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
      );
    }
    await mkdir("dist", { recursive: true });
    await writeFile(outputs.manifest, JSON.stringify({ version: 1, ...app }) + "\n");
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
    const commands = [
      ...(app.backend ? [["--watch", "--no-clear-screen", "src/server/index.ts"]] : []),
      ...(app.frontend
        ? [[tool("vite-plus", "vp"), "dev", "--configLoader", "runner", "--strictPort"]]
        : []),
    ];
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
        const child = spawnBun(command, env);
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
