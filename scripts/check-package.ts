import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "prinpo-package-"));

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed\n${stdout}\n${stderr}`);
}

try {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "stack-package-check",
      private: true,
      type: "module",
      dependencies: { "@prinpo/stack": `file:${resolve(".artifacts/stack.tgz")}` },
    }),
  );
  await run(["bun", "install", "--omit", "peer", "--ignore-scripts"]);
  if (await Bun.file(join(directory, "node_modules/react/package.json")).exists()) {
    throw new Error("The backend check must run without React installed");
  }
  await writeFile(
    join(directory, "server.ts"),
    `
    import { Elysia } from "@prinpo/stack/server";
    import { treaty } from "@prinpo/stack/client";
    const app = new Elysia().get("/hello", () => ({ message: "Backend without React" }));
    const { data, error } = await treaty(app).hello.get();
    if (error || data.message !== "Backend without React") throw new Error("Native API contract failed");
  `,
  );
  await run(["bun", "--no-install", "server.ts"]);
  console.log("Package server and Eden entry points work without React.");

  const peers = await Bun.file("package.json").json();
  await run([
    "bun",
    "add",
    `react@${peers.devDependencies.react}`,
    `react-dom@${peers.devDependencies["react-dom"]}`,
    "--ignore-scripts",
  ]);
  const browser = join(directory, "browser.ts");
  await writeFile(
    browser,
    `
    export { treaty } from "@prinpo/stack/client";
    export { Link, createRouter } from "@prinpo/stack/react";
    export { TanStackRouterDevtools } from "@prinpo/stack/devtools";
  `,
  );
  const result = await Bun.build({ entrypoints: [browser], target: "browser" });
  if (!result.success)
    throw new AggregateError(result.logs, "Browser entry points contain unsupported imports");
  console.log("Package browser entry points bundle without server runtime dependencies.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
