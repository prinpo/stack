import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { devDependencies } from "../../package.json";

export function command(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${args.join(" ")} failed: ${result.error ?? result.stdout + result.stderr}`);
  return result.stdout.trim();
}

export async function preparePackage(source: string, output: string, version: string) {
  const stage = await mkdtemp(join(tmpdir(), "stack-pack-"));
  try {
    await mkdir(output, { recursive: true });
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    manifest.version = version;
    for (const field of ["scripts", "workspaces", "devDependencies", "devEngines", "overrides"])
      delete manifest[field];
    await writeFile(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    for (const file of ["src", "README.md", "LICENSE"])
      await cp(join(source, file), join(stage, file), { recursive: true });
    const tarball = join(output, `prinpo-stack-${version}.tgz`);
    command(["bun", "pm", "pack", "--ignore-scripts", "--filename", tarball], stage);
    const checksum = createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex");
    await writeFile(join(output, "SHA256SUMS"), `${checksum}  ${basename(tarball)}\n`);
    return tarball;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Exercise an installed tarball, never a workspace link or a parent node_modules. */
export async function validatePackage(tarball: string, version: string) {
  const consumer = await mkdtemp(join(tmpdir(), "stack-consumer-"));
  const env: NodeJS.ProcessEnv = { ...process.env, VARLOCK_TELEMETRY_DISABLED: "1", NO_COLOR: "1" };
  delete env.NODE_PATH;
  try {
    const manifest = {
      private: true,
      type: "module",
      dependencies: { "@prinpo/stack": resolve(tarball) },
    };
    await writeFile(join(consumer, "package.json"), JSON.stringify(manifest));
    command(["bun", "install", "--ignore-scripts", "--omit", "peer"], consumer, env);
    await writeFile(
      join(consumer, "backend.ts"),
      `import { Elysia } from "@prinpo/stack/server";
import { loadServerEnv } from "@prinpo/stack/env/server";
import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let reactInstalled = false;
try { require.resolve("react"); reactInstalled = true; } catch {}
if (reactInstalled) throw new Error("Backend-only validation must run without React");
const pkg = await import("@prinpo/stack/package.json");
if (pkg.version !== ${JSON.stringify(version)}) throw new Error("Wrong package version");
for (const path of Object.keys(pkg.exports)) require.resolve("@prinpo/stack" + path.slice(1));
if (!(await readFile(require.resolve("@prinpo/stack/env/defaults"), "utf8")).includes("APP_ENV")) throw new Error("Missing defaults");
await loadServerEnv();
const response = await new Elysia().get("/health", () => "packed").handle(new Request("http://localhost/health"));
if (await response.text() !== "packed" || isStructuredApiError(null)) throw new Error("Broken backend");
`,
    );
    command(["bun", "--no-env-file", "backend.ts"], consumer, env);
    const cli = join(consumer, "node_modules/.bin/stack");
    if (!command([cli, "--version"], consumer, env).includes(version))
      throw new Error("Installed CLI reports the wrong version");

    // Add the application's UI peers and toolchain only after backend-only validation.
    const sourceManifest = JSON.parse(
      await readFile(join(consumer, "node_modules/@prinpo/stack/package.json"), "utf8"),
    );
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({
        ...manifest,
        dependencies: {
          ...manifest.dependencies,
          react: sourceManifest.peerDependencies.react,
          "react-dom": sourceManifest.peerDependencies["react-dom"],
          "vite-plus": devDependencies["vite-plus"],
        },
      }),
    );
    command(["bun", "install", "--ignore-scripts"], consumer, env);
    await writeFile(
      join(consumer, "index.html"),
      '<div id="root"></div><script type="module" src="/main.tsx"></script>',
    );
    await writeFile(
      join(consumer, "main.tsx"),
      'import { createRoot } from "react-dom/client"; import { QueryClient } from "@prinpo/stack/query"; import { createRouter } from "@prinpo/stack/react"; import { treaty } from "@prinpo/stack/client"; createRoot(document.getElementById("root")!).render(<div>{[typeof QueryClient, typeof createRouter, typeof treaty].join(":")}</div>);',
    );
    await writeFile(
      join(consumer, "vite.config.ts"),
      'import { defineConfig } from "vite-plus"; import { stack } from "@prinpo/stack/vite"; export default defineConfig({ plugins: [stack()] });',
    );
    await mkdir(join(consumer, "src/routes"), { recursive: true });
    await writeFile(
      join(consumer, "src/routes/__root.tsx"),
      'import { createRootRoute } from "@prinpo/stack/react"; export const Route = createRootRoute();',
    );
    command([cli, "build"], consumer, env);
    await readFile(join(consumer, "dist/client/index.html"));
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const output = resolve(process.argv[2] ?? "dist/package");
  const manifest = await Bun.file("package.json").json();
  const tarball = await preparePackage(process.cwd(), output, manifest.version);
  await validatePackage(tarball, manifest.version);
  console.log(`Validated ${tarball}`);
}
