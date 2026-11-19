import { createPathsMatcher, getTsconfig } from "get-tsconfig";
import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { isFile, outputs, workerEntry } from "./project";

/** Resolve local imports from the two runtime entries using Bun's own resolver. */
export async function runtimeInputs(backend: boolean, worker: boolean) {
  const entrypoints = [
    ...(backend ? ["src/server/index.ts"] : []),
    ...(worker ? [workerEntry] : []),
  ];
  const result = await Bun.build({
    entrypoints,
    target: "bun",
    packages: "external",
    metafile: true,
    throw: false,
  });
  if (!result.success)
    throw new Error(
      result.logs
        .map((log) => {
          const location = log.position;
          return location ? `${location.file}:${location.line}: ${log.message}` : log.message;
        })
        .join("\n"),
    );
  return result.metafile?.inputs ?? {};
}

/** Preserve module URLs for both Bun commands. */
export async function buildRuntime(backend: boolean, worker: boolean) {
  const inputs = await runtimeInputs(backend, worker);
  await cp("src", `${outputs.server}/src`, { recursive: true });
  // Preserve statically imported local modules or assets outside src as well.
  await Promise.all(
    Object.keys(inputs).map(async (input) => {
      const path = relative(process.cwd(), resolve(input));
      if (isAbsolute(path) || path.startsWith("../")) {
        const importer = Object.keys(inputs).find((source) =>
          inputs[source].imports.some((edge) => edge.path === input),
        );
        throw new Error(
          `Runtime import outside the application: ${input} (imported by ${importer ?? "runtime entry"}). Move it inside the application or use a workspace package.`,
        );
      }
      if (path.startsWith("src/")) return;
      const target = join(outputs.server, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(input, target);
    }),
  );
  if (backend)
    await writeFile(
      outputs.entry,
      'import "@prinpo/stack/browser-log/built";\nprocess.env._STACK_DATABASE_BUILT = "1";\nawait import("./src/server/index.ts");\n',
    );
  if (!isFile("tsconfig.json")) return;
  const source = getTsconfig(resolve("tsconfig.json"));
  if (!source) return;
  const options = source.config.compilerOptions ?? {};
  const matcher = createPathsMatcher(source);
  const relocate = (path: string) => {
    const local = relative(process.cwd(), path);
    if (local === ".." || local.startsWith("../") || isAbsolute(local))
      throw new Error(`Runtime resolution target must be inside the application: ${path}`);
    return `./${local}`;
  };
  const baseUrl = options.baseUrl ? resolve(dirname(source.path), options.baseUrl) : process.cwd();
  const paths = Object.fromEntries(
    Object.keys(options.paths ?? {}).map((alias) => [
      alias,
      (matcher?.(alias) ?? []).map((path) => {
        relocate(path);
        return `./${relative(baseUrl, path)}`;
      }),
    ]),
  );
  await writeFile(
    `${outputs.server}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        ...options,
        baseUrl: options.baseUrl ? relocate(resolve(dirname(source.path), options.baseUrl)) : ".",
        paths,
      },
    }) + "\n",
  );
}
