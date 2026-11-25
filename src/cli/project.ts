import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { readBuildManifest } from "../build-manifest";
import type { ComposePolicy, StackConfig } from "../config/schema";

import { inspectAuth } from "../auth/files";
import { buildManifestPath } from "../build-manifest";
import { inspectDatabase } from "../database/files";
import { isFile } from "../files";
import { inspectI18n } from "../i18n/files";
import { frontendEntry } from "../project-layout";

export { isFile } from "../files";

export const workerEntry = "src/server/worker.ts";
export const composeFiles = {
  dev: "docker-compose.dev.yml",
  preview: "docker-compose.preview.yml",
};

export function inspectCompose(mode: keyof typeof composeFiles, policy?: ComposePolicy) {
  const file = composeFiles[mode];
  if (policy === "external")
    return { enabled: false, reason: `${file} disabled (config override: external)` };
  const enabled = isFile(file);
  const override = policy ? ` (config override: ${policy})` : "";
  return { enabled, reason: `${enabled ? "Found" : "Missing"} ${file}${override}` };
}

export function inspectProject(
  auth: { config?: string; schema?: string } = {},
  config: StackConfig = {},
) {
  const frontend = isFile(frontendEntry);
  const legacyFrontend = !frontend && isFile("index.html");
  const backend = isFile("src/server/index.ts");
  const worker = isFile(workerEntry);
  return {
    frontend: {
      enabled: frontend,
      ready: !legacyFrontend,
      reason: `${frontend ? "Found" : "Missing"} ${frontendEntry}${legacyFrontend ? "; move the root index.html into src/" : ""}`,
    },
    backend: {
      enabled: backend,
      reason: backend ? "Found src/server/index.ts" : "Missing src/server/index.ts",
    },
    worker: {
      enabled: worker,
      reason: `${worker ? "Found" : "Missing"} ${workerEntry}`,
    },
    previewCompose: inspectCompose("preview", config.compose?.preview),
    env: { client: existsSync("env/client"), server: existsSync("env/server") },
    database: inspectDatabase(config.database),
    auth: inspectAuth(auth.config, auth.schema),
    i18n: inspectI18n(),
    compose: inspectCompose("dev", config.compose?.dev),
  };
}

export function capabilities(config: StackConfig) {
  const project = inspectProject({}, config);
  if (!project.frontend.ready) throw new Error(project.frontend.reason);
  if (!project.frontend.enabled && !project.backend.enabled && !project.worker.enabled)
    throw new Error(
      "No application found. Expected src/index.html, src/server/index.ts, or src/server/worker.ts. Run stack doctor.",
    );
  return {
    frontend: project.frontend.enabled,
    backend: project.backend.enabled,
    worker: project.worker.enabled,
  };
}

export const outputs = {
  client: "dist/client",
  server: "dist/server",
  entry: "dist/server/index.js",
  serverSource: "dist/server/src/server/index.ts",
  manifest: buildManifestPath,
  workerEntry: "dist/server/src/server/worker.ts",
};

export function absolute(path: string) {
  return resolve(process.cwd(), path);
}

export function builtHttpEntry(manifest: ReturnType<typeof readBuildManifest>) {
  if (!manifest.frontend && !manifest.backend)
    throw new Error(
      "This build has no HTTP entry. Run stack worker for a worker-only application.",
    );
  for (const [enabled, path] of [
    [manifest.frontend, `${outputs.client}/index.html`],
    [manifest.backend, outputs.entry],
    [manifest.backend, outputs.serverSource],
  ] as const)
    if (enabled && !isFile(path))
      throw new Error(`Build artifact missing or invalid: ${path}. Run stack build.`);
  return manifest.backend
    ? outputs.entry
    : fileURLToPath(new URL("../start-frontend.ts", import.meta.url));
}

export function builtWorkerEntry(manifest: ReturnType<typeof readBuildManifest>) {
  if (!manifest.worker)
    throw new Error("Build has no worker entry. Add src/server/worker.ts and run stack build.");
  if (!isFile(outputs.workerEntry))
    throw new Error(`Missing worker entry: ${outputs.workerEntry}. Run stack build.`);
  return outputs.workerEntry;
}
