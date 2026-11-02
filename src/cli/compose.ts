import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { type Server, createServer } from "node:net";

import { developmentComposeFile, isFile } from "./project";
import { stop } from "./tools";

async function docker(
  args: string[],
  options: { signal?: AbortSignal; timeout?: number; capture?: boolean } = {},
) {
  const { signal, timeout, capture } = options;
  if (signal?.aborted) return { status: Number(signal.reason), stdout: "" };
  const child = spawn("docker", args, {
    detached: true,
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  let stopping: Promise<void> | undefined;
  let timedOut = false;
  const cancel = () => {
    stopping ??= stop(child);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = timeout
    ? setTimeout(() => {
        timedOut = true;
        console.error(`Docker command timed out: docker ${args.join(" ")}`);
        cancel();
      }, timeout)
    : undefined;
  try {
    const status = await new Promise<number>((done) => {
      child.once("error", (error) => {
        console.error(error.message);
        done(1);
      });
      child.once("close", (code) => done(code ?? 1));
    });
    await stopping;
    return { status: signal?.aborted ? Number(signal.reason) : timedOut ? 1 : status, stdout };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Manage infrastructure for one development session, without loading app configuration. */
export function developmentCompose() {
  const enabled = isFile(developmentComposeFile);
  const args = ["compose", "-f", developmentComposeFile];
  let target: string[] = [];
  let projectName = "";
  let started = false;
  let lock: Server | undefined;
  return {
    async start(signal: AbortSignal) {
      if (!enabled) return 0;
      for (const [check, message] of [
        [["--version"], "Docker CLI is unavailable. Install Docker before running stack dev."],
        [
          ["compose", "version"],
          "Docker Compose is unavailable. Install the Docker Compose plugin.",
        ],
      ] as const) {
        const result = await docker([...check], { signal, timeout: 15_000, capture: true });
        if (result.status !== 0) {
          if (!signal.aborted) console.error(message);
          return result.status;
        }
      }
      // Explicit Docker environment settings already select a stable target. Pin an
      // implicit context so a later `docker context use` cannot redirect cleanup.
      if (!process.env.DOCKER_CONTEXT && !process.env.DOCKER_HOST) {
        const context = await docker(["context", "show"], {
          signal,
          timeout: 15_000,
          capture: true,
        });
        if (context.status !== 0) return context.status;
        target = ["--context", context.stdout.trim()];
      }
      const daemon = await docker([...target, "info", "--format", "{{.ID}}"], {
        signal,
        timeout: 15_000,
        capture: true,
      });
      if (daemon.status !== 0) {
        if (!signal.aborted)
          console.error(
            "Docker daemon is unavailable. Check that Docker is running and accessible.",
          );
        return daemon.status;
      }
      const config = await docker([...target, ...args, "config", "--format", "json"], {
        signal,
        capture: true,
        timeout: 15_000,
      });
      if (config.status !== 0) return config.status;
      const project: unknown = JSON.parse(config.stdout);
      if (
        !project ||
        typeof project !== "object" ||
        !("name" in project) ||
        typeof project.name !== "string"
      )
        throw new Error("Docker Compose did not return a project name.");
      projectName = project.name;
      args.push("--project-name", projectName);
      const key = createHash("sha256")
        .update(JSON.stringify([daemon.stdout.trim(), project.name]))
        .digest("hex");
      const server = createServer((socket) => socket.destroy());
      try {
        // Linux abstract sockets disappear when the owning process exits, including SIGKILL.
        await new Promise<void>((done, reject) => {
          server.once("error", reject);
          server.listen(`\0prinpo-stack-compose-${key}`, done);
        });
        lock = server;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE"))
          throw error;
        console.error(
          `Another Stack development session is managing Compose project ${project.name}.`,
        );
        return 1;
      }
      if (signal.aborted) return Number(signal.reason);
      started = true;
      return (
        await docker([...target, ...args, "up", "--wait", "--wait-timeout", "120"], { signal })
      ).status;
    },
    async stop() {
      try {
        if (!started) return 0;
        started = false;
        // Target existing resources even if the Compose file changed or disappeared.
        return (
          await docker(
            [...target, "compose", "--project-name", projectName, "stop", "--timeout", "10"],
            {
              timeout: 30_000,
            },
          )
        ).status;
      } finally {
        if (lock) {
          const server = lock;
          lock = undefined;
          await new Promise<void>((done, reject) =>
            server.close((error) => (error ? reject(error) : done())),
          );
        }
      }
    },
  };
}
