import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function isFile(path: string) {
  return existsSync(path) && statSync(path).isFile();
}

export function inspectProject() {
  const frontend = isFile("index.html");
  const backend = isFile("src/server/index.ts");
  return {
    frontend: { enabled: frontend, reason: frontend ? "Found index.html" : "Missing index.html" },
    backend: {
      enabled: backend,
      reason: backend ? "Found src/server/index.ts" : "Missing src/server/index.ts",
    },
    env: { client: existsSync("env/client"), server: existsSync("env/server") },
  };
}

export function capabilities() {
  const project = inspectProject();
  if (!project.frontend.enabled && !project.backend.enabled)
    throw new Error(
      "No application found. Expected index.html or src/server/index.ts. Run stack doctor.",
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
