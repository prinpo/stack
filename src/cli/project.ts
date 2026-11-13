import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { inspectAuth } from "../auth/files";
import { inspectDatabase } from "../database/files";
import { isFile } from "../files";
import { frontendEntry } from "../project-layout";

export { isFile } from "../files";

export const developmentComposeFile = "docker-compose.dev.yml";

export function inspectProject(auth: { config?: string; schema?: string } = {}) {
  const frontend = isFile(frontendEntry);
  const legacyFrontend = !frontend && isFile("index.html");
  const backend = isFile("src/server/index.ts");
  const compose = isFile(developmentComposeFile);
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
    env: { client: existsSync("env/client"), server: existsSync("env/server") },
    database: inspectDatabase(),
    auth: inspectAuth(auth.config, auth.schema),
    compose: {
      enabled: compose,
      reason: `${compose ? "Found" : "Missing"} ${developmentComposeFile}`,
    },
  };
}

export function capabilities() {
  const project = inspectProject();
  if (!project.frontend.ready) throw new Error(project.frontend.reason);
  if (!project.frontend.enabled && !project.backend.enabled)
    throw new Error(
      "No application found. Expected src/index.html or src/server/index.ts. Run stack doctor.",
    );
  return { frontend: project.frontend.enabled, backend: project.backend.enabled };
}

export const outputs = {
  client: "dist/client",
  server: "dist/server",
  entry: "dist/server/index.js",
  manifest: "dist/manifest.json",
};

export function absolute(path: string) {
  return resolve(process.cwd(), path);
}
