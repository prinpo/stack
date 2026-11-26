import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { version } from "../../../package.json";
import toolchain from "./toolchain.json";

export type Editor = "zed" | "vscode";

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** Application-owned files; toolchain pins survive release manifest stripping. */
export async function writeProject(directory: string, name: string, editors: Editor[]) {
  const files: Record<string, string> = {
    "package.json": json({
      name,
      private: true,
      type: "module",
      scripts: {
        dev: "stack dev",
        build: "stack build",
        preview: "stack preview",
        start: "stack start",
        worker: "stack worker",
        check: "bun --bun vp check",
        fmt: "bun --bun vp fmt",
        lint: "bun --bun vp lint",
        test: "bun --bun vp test run",
        prepare: "bun --bun vp config --no-agent",
      },
      dependencies: {
        "@prinpo/stack": version,
        react: toolchain.react,
        "react-dom": toolchain["react-dom"],
      },
      devDependencies: Object.fromEntries(
        Object.entries(toolchain).filter(([key]) => !["bun", "react", "react-dom"].includes(key)),
      ),
      overrides: { vite: toolchain.vite },
      devEngines: { packageManager: { name: "bun", version: toolchain.bun, onFail: "download" } },
      engines: { bun: `>=${toolchain.bun}` },
    }),
    "bunfig.toml": 'env = false\n\n[install]\nlinker = "hoisted"\n',
    "tsconfig.json": json({
      compilerOptions: {
        target: "ESNext",
        lib: ["ESNext", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        types: ["bun", "node", "vite-plus/client"],
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noEmit: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
      },
      include: ["src", "tests", "*.config.ts"],
    }),
    "vite.config.ts": await readFile(new URL("./vite.config.txt", import.meta.url), "utf8"),
    "src/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Stack</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
`,
    "src/main.tsx": `import { createRootAndRender, createRouter } from "@prinpo/stack/react";

import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRootAndRender(router);
`,
    "src/routes/__root.tsx": `import { Outlet, createRootRoute } from "@prinpo/stack/react";

export const Route = createRootRoute({ component: Outlet });
`,
    "src/routes/index.tsx": `import { createFileRoute } from "@prinpo/stack/react";

export const Route = createFileRoute("/")({
  component: () => <h1>Welcome to Stack</h1>,
});
`,
    ".gitignore":
      "node_modules/\ndist/\ncoverage/\n.tanstack/\n.evlog/\n*.log\n*.sqlite\n*.sqlite-*\n*.tsbuildinfo\n.DS_Store\n.env\n.env.*\n!.env.example\n!.env.schema\n",
    "AGENTS.md":
      "Before creating or changing application structure, frontend, backend, API queries,\nenvironment, database, authentication, logging, background jobs, or development/build workflows,\nread node_modules/@prinpo/stack/docs/consumer/README.md and follow its task-specific links.\nUse Stack's applicable Blocks, helpers, and CLI before implementing custom integration.\n\nUse Bun and the project-local Vite+ toolchain. Run direct commands with\n`bun --bun vp <command>`; no global vp installation is required. Use Vitest\nthrough `vite-plus/test`, with tests under src/ or tests/. Run `bun run check`\nand `bun run test` after changes.\n",
    "README.md": `# ${name}\n\nRun \`bun run dev\` to open the TanStack Router frontend. Edit \`src/routes/index.tsx\` to change the home page.\nUse \`bun run build\` followed by \`bun run preview\` to try the built app locally.\n\nRun \`bun install --frozen-lockfile\`, \`bun run check\`, and \`bun run test\` to verify the project.\nUse \`bun run fmt\` to format files and \`bun run lint\` to lint and typecheck.\nTests use \`vite-plus/test\` and live under \`src/\` or \`tests/\`. An empty test suite succeeds.\n\nUse AGENTS.md and the installed Stack docs to extend the app.\nAdd \`src/server/index.ts\` for an HTTP backend or \`src/server/worker.ts\` for a jobs worker.\nIn production use \`bun run start\` for HTTP and \`bun run worker\` for each worker replica.\n\n${editors.includes("zed") ? "For Zed, install the Oxc extension (Oxlint and Oxfmt language servers).\n" : ""}${editors.includes("vscode") ? "For VS Code, install the recommended Vite Plus Extension Pack.\n" : ""}Editor settings belong to this project; extensions are installed separately.\n`,
  };
  if (editors.length) {
    files["EDITOR_SETTINGS_LICENSE"] = await readFile(
      new URL("./editors/LICENSE", import.meta.url),
      "utf8",
    );
    files["README.md"] +=
      "\nEditor settings are adapted from Vite+ under MIT; see EDITOR_SETTINGS_LICENSE.\n";
  }
  if (editors.includes("zed"))
    files[".zed/settings.json"] = await readFile(
      new URL("./editors/zed.json", import.meta.url),
      "utf8",
    );
  if (editors.includes("vscode")) {
    files[".vscode/settings.json"] = await readFile(
      new URL("./editors/vscode.json", import.meta.url),
      "utf8",
    );
    files[".vscode/extensions.json"] = json({
      recommendations: ["VoidZero.vite-plus-extension-pack"],
    });
  }
  for (const [path, contents] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, { flag: "wx" });
  }
}
