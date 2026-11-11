import { resolve } from "node:path";

export const frontendEntry = "src/index.html";
export const generatedEnvDirectory = "src/env-gen";

/** CLI roots refer to the source directory; standalone Vite roots refer to the project. */
export function viteProjectRoot(root?: string) {
  return resolve(process.env._STACK_VITE_PROJECT_ROOT ?? root ?? process.cwd());
}
