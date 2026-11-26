import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative } from "node:path";

const cliTests = [
  "auth-cli",
  "browser-log-dev",
  "cli",
  "cli-compose",
  "cli-init",
  "database",
  "jobs-lifecycle",
  "jobs-workers",
];
const envTests = ["env-build", "env-files", "env-runtime", "env-server", "env-vite"];
const viteTests = ["browser-log-dev", "env-vite", "vite", "vite-cleanup"];
const jobsTests = ["jobs", "jobs-lifecycle", "jobs-regressions", "jobs-workers"];

// These tests read inputs at runtime or start another process. Match specific inputs first.
const runtimeInputs: [RegExp, string[]][] = [
  [/^src\/cli\/compose\.ts$/, ["cli-compose"]],
  [/^src\/cli\/docker\.ts$/, ["cli-compose"]],
  [/^src\/cli\/init(?:\.ts$|\/)/, ["cli-init", "package-release"]],
  [/^src\/cli\/auth(?:-schema)?\.ts$/, ["auth-cli"]],
  [
    /^src\/cli\/|^src\/(?:build-manifest|config|files|processes|project-layout)\.ts$|^src\/config\//,
    cliTests,
  ],
  [/^src\/env(?:\.ts$|\/)|^scripts\/probe-varlock\.ts$/, [...envTests, ...cliTests]],
  [
    /^src\/(?:server|serve-app|spa|start-server|start-frontend|api-prefix)\.ts$/,
    ["auth-startup", ...envTests, ...cliTests],
  ],
  [
    /^src\/(?:vite|router-generator|react)\.tsx?$|^tests\/test-utils\/vite-server\.ts$/,
    [...viteTests, "cli", "cli-compose", "package-release"],
  ],
  [/^src\/browser-log\/preload\.ts$/, ["browser-log", "browser-log-dev"]],
  [/^src\/browser-log(?:\.ts$|\/)/, ["browser-log", ...viteTests, "cli"]],
  [/^src\/auth(?:\.ts$|\/)/, ["auth-cli", "auth-sqlite", "auth-startup"]],
  [
    /^src\/database(?:\.ts$|\/)|^scripts\/generate-database-exports\.ts$/,
    ["database", "auth-sqlite", "package-release"],
  ],
  [/^src\/jobs(?:\.ts$|\/)|^tests\/test-utils\/redis\.ts$/, jobsTests],
  [/^examples\/fullstack\/(?:env\/|src\/server\/routes\/environment\.ts$)/, ["env-files"]],
  [
    /^examples\/fullstack\/(?:migrations\/|src\/server\/(?:database\/|validation\/|routes\/(?:notes|notebooks)\.ts$))/,
    ["database", "auth-sqlite", "jobs-workers"],
  ],
  [/^examples\/fullstack\/src\/server\/jobs\//, ["jobs-workers"]],
  [
    /^scripts\/release\//,
    [
      "package-release",
      "release-finalization",
      "release-policy",
      "release-publication",
      "release-resolution",
    ],
  ],
  [/^docs\/consumer\/|^(?:LICENSE|README\.md)$/, ["package-release"]],
];

const runtimeTest = /^tests\/.*\.test\.[cm]?[jt]sx?$/;
const graphInputs =
  /^src\/(?:eden-query\/|i18n(?:\.ts$|\/)|logger(?:\.ts$|\/)|(?:api-client|client|devtools|openapi|query)\.tsx?$)|^tests\/(?:eden-query\/|test-utils\/directory\.ts$|.*\.types\.ts$)/;
const referenceDocs =
  /^docs\/(?:adr|agents|milestones|research)\/.*\.md$|^(?:AGENTS|CODING_STANDARDS|GLOSSARY)\.md$/;

function git(...args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

function runTests(files: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--bun", "vp", "test", "run", "--maxWorkers=8", ...files],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function selectTests(base: string) {
  const ref = git("rev-parse", "--verify", "--end-of-options", `${base}^{commit}`).trim();
  const mergeBase = git("merge-base", ref, "HEAD").trim();
  const changed = new Set([
    ...git("diff", "--no-renames", "--name-only", "-z", mergeBase, "HEAD").split("\0"),
    ...git("diff", "--no-renames", "--name-only", "-z", "--cached").split("\0"),
    ...git("ls-files", "--modified", "--others", "--exclude-standard", "-z").split("\0"),
  ]);
  changed.delete("");
  const files = new Set<string>();
  let needsGraph = false;

  for (const path of changed) {
    if (referenceDocs.test(path)) continue;
    if (runtimeTest.test(path)) {
      if (existsSync(path)) files.add(path);
      continue;
    }

    const rule = runtimeInputs.find(([pattern]) => pattern.test(path));
    if (!rule && !graphInputs.test(path))
      return { full: `Shared or unclassified input: ${path}`, files };
    for (const suite of rule?.[1] ?? []) files.add(`tests/${suite}.test.ts`);
    needsGraph = true;
  }

  if (!needsGraph) return { files };

  const list = spawnSync(
    process.execPath,
    ["--bun", "vp", "test", "list", "--filesOnly", "--json", `--changed=${mergeBase}`],
    { encoding: "utf8" },
  );
  if (list.error) throw list.error;
  if (list.status !== 0) throw new Error(list.stderr.trim() || "Vitest test discovery failed");
  const matches: { file: string }[] = JSON.parse(list.stdout);
  for (const { file } of matches) files.add(relative(process.cwd(), file));
  if (!files.size) return { full: "No tests matched the changed source files", files };
  return { files };
}

function main() {
  if (process.argv.length > 3) throw new Error("Usage: bun run test:changed [base]");
  let selection: ReturnType<typeof selectTests>;
  try {
    selection = selectTests(process.argv[2] ?? "origin/main");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.log("Test selection failed. Running all test projects.");
    return runTests([]);
  }
  if (selection.full) {
    console.log(`${selection.full}. Running all test projects.`);
    return runTests([]);
  }
  const files = [...selection.files].sort();
  if (!files.length) {
    console.log("No runnable test files selected for this diff.");
    return 0;
  }
  console.log(`Selected test files:\n${files.join("\n")}\n`);
  return runTests(files);
}

process.exitCode = main();
