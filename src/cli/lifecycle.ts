import type { ChildProcess } from "node:child_process";

import { defineCommand, showUsage } from "citty";
import { existsSync, watch } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { StackConfig } from "../config/schema";

import { buildManifestVersion, readBuildManifest } from "../build-manifest";
import { readStackConfig } from "../config/load";
import { builtDatabase } from "../database/files";
import { serverEnvPaths } from "../env/paths";
import { loadStaticEnv, readJobsShutdownTimeout } from "../env/server";
import { jobsCleanupTimeoutMs } from "../jobs/lifecycle";
import { sessionCompose } from "./compose";
import { buildDatabase } from "./database-build";
import { frontendArguments, frontendEnvironment } from "./frontend";
import { environment, profileArgs, takeOptions } from "./options";
import { type Area, type BuildResult, buildSummary, heading, intro, restartNotice } from "./output";
import { builtHttpEntry, builtWorkerEntry, capabilities, outputs, workerEntry } from "./project";
import { buildRuntime, runtimeInputs } from "./runtime-build";
import { runLifecycleScript } from "./scripts";
import { runBun, spawnBun, stop } from "./tools";

function lifecycleCommand(
  name: string,
  description: string,
  action: (env: NodeJS.ProcessEnv) => Promise<void>,
) {
  const mode = name === "dev" ? "development" : "production";
  const defaultProfile = name === "preview" ? "development" : mode;
  const command = defineCommand({
    meta: { name, description },
    args: {
      env: {
        ...profileArgs.env,
        description: `Environment profile (defaults to APP_ENV or ${defaultProfile})`,
      },
    },
    async run({ rawArgs }) {
      if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        await showUsage(command, { meta: { name: "stack" } });
        return;
      }
      const { values, rest } = takeOptions(rawArgs, ["env"]);
      if (rest.length) throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
      await action(
        environment(typeof values.env === "string" ? values.env : undefined, mode, defaultProfile),
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
    const { config } = await readStackConfig();
    const preStatus = await runLifecycleScript(config.scripts?.build?.pre, "build pre", env);
    if (preStatus) {
      process.exitCode = preStatus;
      return;
    }
    const app = capabilities(config);
    const results: BuildResult[] = [];
    await Promise.all(
      [outputs.client, outputs.server, "dist/database"].map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    );
    const database = await buildDatabase(env, config.database);
    if (app.frontend) {
      const frontendStarted = performance.now();
      heading("frontend", "Building browser assets");
      if (existsSync("env/client"))
        await loadStaticEnv(["env/client"], {
          values: env,
          profile: env.APP_ENV,
          publicOnly: true,
        });
      await runBun(
        [...frontendArguments("build"), "--outDir", resolve(outputs.client)],
        frontendEnvironment(env),
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
    const { worker } = app;
    if (app.backend || worker) {
      const backendStarted = performance.now();
      const area = app.backend ? "backend" : "worker";
      heading(area, "Packaging Bun runtime modules");
      if (!database) await loadStaticEnv(serverEnvPaths(), { values: env, profile: env.APP_ENV });
      await buildRuntime(app.backend, worker);
      const milliseconds = performance.now() - backendStarted;
      results.push({
        area,
        directory: outputs.server,
        milliseconds,
        bytes: await outputSize(outputs.server),
      });
    }
    const postStatus = await runLifecycleScript(config.scripts?.build?.post, "build post", env);
    if (postStatus) {
      process.exitCode = postStatus;
      return;
    }
    await mkdir("dist", { recursive: true });
    await writeFile(
      outputs.manifest,
      JSON.stringify({
        version: buildManifestVersion,
        ...app,
        database,
        config: {
          database: config.database ?? "managed",
          scripts: { start: config.scripts?.start, worker: config.scripts?.worker },
        },
      }) + "\n",
    );
    buildSummary(results, performance.now() - started, env.APP_ENV ?? "production");
  },
);

export const start = lifecycleCommand(
  "start",
  "Run the built HTTP server in production",
  async (env) => {
    const manifest = readBuildManifest();
    const entry = builtHttpEntry(manifest);
    builtDatabase(manifest);
    const status = await runLifecycleScript(manifest.config.scripts?.start?.pre, "start pre", env);
    if (status) {
      process.exitCode = status;
      return;
    }
    const startup = {
      ...env,
      _SERVE_CLIENT: manifest.frontend ? "1" : "0",
      _STACK_DATABASE_BUILT: "1",
    };
    const inherited = Object.fromEntries(
      Object.entries(startup).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    process.execve!(process.execPath, [process.execPath, "--no-env-file", entry], inherited);
  },
);

type LocalCommand = { area: Area; args: string[]; waitForHttp?: boolean };

function developmentCommands(app: ReturnType<typeof capabilities>) {
  const commands: LocalCommand[] = [];
  if (app.worker) commands.push({ area: "worker", args: [workerEntry] });
  if (app.backend)
    commands.push({
      area: "backend",
      args: [
        ...(app.worker ? [] : ["--watch", "--no-clear-screen"]),
        "--preload",
        fileURLToPath(new URL("../browser-log/preload.ts", import.meta.url)),
        "src/server/index.ts",
      ],
    });
  if (app.frontend)
    commands.push({
      area: "frontend",
      args: [...frontendArguments("dev"), "--strictPort", "--clearScreen", "false"],
    });
  return commands;
}

function previewCommands(app: ReturnType<typeof readBuildManifest>) {
  const commands: LocalCommand[] = [];
  const database = builtDatabase(app);
  const http = app.frontend || app.backend;
  if (http) {
    const entry = builtHttpEntry(app);
    commands.push({
      area: app.backend ? "backend" : "frontend",
      args: app.worker
        ? [
            fileURLToPath(new URL("./preview-http.ts", import.meta.url)),
            ...(app.backend ? [resolve(entry)] : []),
          ]
        : [entry],
      waitForHttp: app.worker,
    });
  }
  if (app.worker)
    commands.push({
      area: "worker",
      args: [
        ...(!http && database
          ? ["--preload", fileURLToPath(new URL("./preview-migrate.ts", import.meta.url))]
          : []),
        builtWorkerEntry(app),
      ],
    });
  return commands;
}

export const dev = lifecycleCommand(
  "dev",
  "Run detected capabilities with native code watching",
  async (env) => {
    const { config } = await readStackConfig();
    const app = capabilities(config);
    return localSession("dev", env, app, developmentCommands(app), config);
  },
);
export const preview = lifecycleCommand(
  "preview",
  "Run the last build locally with preview services and workers",
  async (env) => {
    const app = readBuildManifest();
    const { config } = await readStackConfig();
    return localSession("preview", env, app, previewCommands(app), config);
  },
);

async function localSession(
  mode: "dev" | "preview",
  env: NodeJS.ProcessEnv,
  app: ReturnType<typeof capabilities>,
  commands: LocalCommand[],
  config: StackConfig,
) {
  const watching = mode === "dev";
  intro(mode, env.APP_ENV);
  let children: ChildProcess[] = [];
  const areas = new WeakMap<ChildProcess, Area>();
  const gracePeriods = new WeakMap<ChildProcess, number>();
  const stopChild = (child: ChildProcess) =>
    stop(child, "SIGTERM", gracePeriods.get(child) ?? 2000, app.worker && gracePeriods.has(child));
  const stopChildren = async (previous: ChildProcess[]) => {
    // HTTP requests already waiting for jobs can finish while the worker is available.
    await Promise.all(previous.filter((child) => areas.get(child) !== "worker").map(stopChild));
    await Promise.all(previous.filter((child) => areas.get(child) === "worker").map(stopChild));
  };
  const compose = sessionCompose(mode, config.compose?.[mode]);
  const scripts = config.scripts?.[mode];
  const cancellation = new AbortController();
  let postCancellation: AbortController | undefined;
  let runPost = false;
  let launched = false;
  let closing = false;
  let finish!: (status: number) => void;
  const completed = new Promise<number>((done) => {
    finish = done;
  });
  const close = (status: number) => {
    if (!closing) {
      closing = true;
      cancellation.abort(status);
      finish(status);
    }
  };
  let imports: Set<string> | undefined;
  const launch = async (targets = commands) => {
    const grace =
      app.backend || app.worker
        ? await readJobsShutdownTimeout({ profile: env.APP_ENV, values: env })
        : 0;
    if (watching && app.worker) {
      // If the graph is incomplete, watch all source and let Bun report startup errors.
      const inputs = await runtimeInputs(app.backend, true).catch(() => undefined);
      imports = inputs && new Set(Object.keys(inputs).map((path) => resolve(path)));
    }
    if (closing) return;
    launched = true;
    const sessionEnv = {
      ...env,
      _STACK_LOCAL_SESSION: "1",
      ...(!watching && { _STACK_DATABASE_BUILT: "1", _SERVE_CLIENT: app.frontend ? "1" : "0" }),
    };
    for (const command of targets) {
      const child = spawnBun(
        command.args,
        watching && command.area === "frontend" ? frontendEnvironment(sessionEnv) : sessionEnv,
        "inherit",
        command.area,
        watching || command.area === "backend" || command.waitForHttp,
      );
      children.push(child);
      areas.set(child, command.area);
      if (!watching || command.area !== "frontend")
        gracePeriods.set(child, Math.min(2_147_483_647, grace + jobsCleanupTimeoutMs));
      if (watching && command.area === "backend")
        child.on("message", (message) => {
          if (
            message &&
            typeof message === "object" &&
            "type" in message &&
            message.type === "stack:browser-log"
          )
            for (const receiver of children)
              if (receiver !== child && receiver.connected) receiver.send(message, () => {});
        });
      child.once("error", (error) => {
        console.error(error.message);
        close(1);
      });
      child.once("exit", (code) => {
        if (children.includes(child)) close(code || 1);
      });
      if (command.waitForHttp) {
        const ready = Promise.withResolvers<void>();
        const onReady = (message: unknown) => {
          if (message === "stack:http-ready") ready.resolve();
        };
        child.on("message", onReady);
        await Promise.race([ready.promise, completed]);
        child.off("message", onReady);
        if (closing) return;
      }
    }
  };
  const signalSession = (status: number) => {
    postCancellation?.abort(status);
    close(status);
  };
  const interrupt = () => signalSession(130);
  const terminate = () => signalSession(143);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  let restarting = Promise.resolve();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let restartFrontend = false;
  const directories = watching
    ? [
        ...((app.backend || app.worker) && existsSync("env/server") ? ["env/server"] : []),
        ...(app.worker ? ["src"] : []),
      ]
    : [];
  const watchers = directories.map((directory) =>
    watch(directory, { recursive: true }, (_, file) => {
      const changedPath = file ? join(directory, file) : directory;
      const sourceEdit = directory === "src";
      if (
        sourceEdit &&
        file &&
        file.split(sep)[0] !== "server" &&
        imports &&
        !imports.has(resolve(changedPath))
      )
        return;
      if (!sourceEdit) restartFrontend = true;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const fullRestart = restartFrontend;
        restartFrontend = false;
        restarting = restarting
          .then(async () => {
            const previous = children.filter(
              (child) => fullRestart || areas.get(child) !== "frontend",
            );
            children = children.filter((child) => !previous.includes(child));
            await stopChildren(previous);
            if (!closing && launched) {
              restartNotice(changedPath, commands.length > 1);
              await launch(
                commands.filter((command) => fullRestart || command.area !== "frontend"),
              );
            }
          })
          .catch((error) => {
            console.error(error);
            close(1);
          });
      }, 100);
    }),
  );
  for (const watcher of watchers)
    watcher.on("error", (error) => {
      console.error(error.message);
      close(1);
    });
  try {
    const startupStatus = await compose.start(cancellation.signal);
    if (startupStatus !== 0 || closing) {
      process.exitCode = startupStatus || Number(cancellation.signal.reason);
      return;
    }
    runPost = true;
    const preStatus = await runLifecycleScript(
      scripts?.pre,
      `${mode} pre`,
      env,
      cancellation.signal,
    );
    if (preStatus) close(preStatus);
    if (!closing) await launch();
    process.exitCode = await completed;
  } catch (error) {
    process.exitCode ||= 1;
    throw error;
  } finally {
    try {
      clearTimeout(debounce);
      for (const watcher of watchers) watcher.close();
      await restarting;
      await stopChildren(children);
      if (runPost && scripts?.post) {
        postCancellation = new AbortController();
        const status = await runLifecycleScript(
          scripts.post,
          `${mode} post`,
          env,
          postCancellation.signal,
        );
        process.exitCode ||= status;
      }
    } finally {
      try {
        const status = await compose.stop();
        if (status) {
          console.error(`Failed to stop ${watching ? "development" : "preview"} Compose services.`);
          process.exitCode ||= status;
        }
      } finally {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
      }
    }
  }
}
