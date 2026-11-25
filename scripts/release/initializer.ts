import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { command } from "./command";

/** Publish only the candidate tarball to an ephemeral registry, not to npm. */
export async function validateInitializer(
  tarball: string,
  version: string,
  cli: string,
  env: NodeJS.ProcessEnv,
) {
  const root = await mkdtemp(join(tmpdir(), "stack-init-consumer-"));
  let registry: ReturnType<typeof spawn> | undefined;
  try {
    const script = join(root, "registry.ts");
    await writeFile(
      script,
      `
const tarball=Bun.file(process.argv[2]);
const manifest=JSON.parse(process.argv[3]);
const shasum=new Bun.CryptoHasher("sha1").update(await tarball.arrayBuffer()).digest("hex");
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
  const url=new URL(request.url);
  if(url.pathname==="/stack.tgz")return new Response(tarball);
  if(decodeURIComponent(url.pathname)==="/@prinpo/stack")return Response.json({name:manifest.name,"dist-tags":{latest:manifest.version},versions:{[manifest.version]:{...manifest,dist:{tarball:new URL("/stack.tgz",url).href,shasum}}}});
  return Response.redirect("https://registry.npmjs.org"+url.pathname+url.search,302);
}});
console.log(server.url.origin);
`,
    );
    const manifest = command(["tar", "-xOf", tarball, "package/package.json"], root);
    registry = spawn("bun", ["--no-env-file", script, tarball, manifest], {
      env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const origin = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Registry did not start")), 10_000);
      registry!.once("error", reject);
      registry!.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Registry exited before readiness"));
      });
      registry!.stdout!.once("data", (chunk) => {
        clearTimeout(timer);
        done(String(chunk).trim());
      });
    });
    const bin = join(root, "bin");
    await mkdir(bin);
    const bun = command(["bun", "--eval", "console.log(process.execPath)"], root);
    await symlink(bun, join(bin, "bun"));
    // Exclude user/global package-manager bin directories; every vp must be local.
    const path = `${bin}:/usr/bin:/bin`;
    const installEnv: NodeJS.ProcessEnv = {
      ...env,
      PATH: path,
      BUN_CONFIG_REGISTRY: origin,
      CI: "1",
    };
    delete installEnv.VITEST;
    command(
      [
        "bun",
        "--eval",
        'if(Bun.which("vp"))throw new Error("Global vp leaked into initializer validation");',
      ],
      root,
      installEnv,
    );
    const result = command(
      [cli, "init", "empty-app", "--editor", "zed", "--editor", "vscode"],
      root,
      installEnv,
    );
    if (!result.includes("Ready")) throw new Error("Initializer did not finish");
    const app = join(root, "empty-app");
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
    const installed = JSON.parse(
      await readFile(join(app, "node_modules/@prinpo/stack/package.json"), "utf8"),
    );
    if (pkg.dependencies["@prinpo/stack"] !== version || installed.version !== version)
      throw new Error("Initializer did not pin its own release");
    if ((await readdir(app)).includes("src"))
      throw new Error("Initializer generated application source");
    await access(join(app, ".zed/settings.json"));
    await access(join(app, ".vscode/extensions.json"));
    if (
      !(await readFile(join(app, "AGENTS.md"), "utf8")).includes(
        "node_modules/@prinpo/stack/docs/consumer/README.md",
      )
    )
      throw new Error("Missing agent docs pointer");
    if (command(["git", "branch", "--show-current"], app) !== "main")
      throw new Error("Wrong initial branch");
    if (command(["git", "log", "--all", "--oneline"], app) !== "")
      throw new Error("Unexpected initial commit");
    if (!command(["git", "config", "core.hooksPath"], app)) throw new Error("Missing Git hooks");
    command(["bun", "install", "--frozen-lockfile"], app, installEnv);
    for (const task of ["check", "lint", "test"]) command(["bun", "run", task], app, installEnv);
    command(["bun", "--bun", "vp", "fmt", "--check"], app, installEnv);
    command(["git", "add", "README.md"], app, installEnv);
    command(["git", "hook", "run", "pre-commit"], app, installEnv);
    // Both public test locations remain discoverable after a browser entry exists.
    await mkdir(join(app, "src"));
    await mkdir(join(app, "tests"));
    await writeFile(join(app, "src/index.html"), "<html></html>");
    for (const location of ["src", "tests"]) {
      await writeFile(
        join(app, location, "probe.test.ts"),
        'import {test,expect} from "vite-plus/test"; test("discovered",()=>expect(1).toBe(1));',
      );
    }
    const tests = command(["bun", "run", "test"], app, installEnv);
    if (!tests.includes("2 passed")) throw new Error("Tests were not discovered at both locations");
    await writeFile(join(app, "src/type-error.ts"), 'export const count: number = "wrong";');
    let rejected = false;
    try {
      command(["bun", "--bun", "vp", "check", "--no-fmt"], app, installEnv);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("TS2322")) throw error;
      rejected = true;
    }
    if (!rejected) throw new Error("Generated checks did not catch a TypeScript error");
    await rm(join(app, "src/type-error.ts"));
    await mkdir(join(app, "src/routes"));
    await writeFile(
      join(app, "src/index.html"),
      '<!doctype html><html><head><title>Stack</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
    );
    await writeFile(
      join(app, "src/main.tsx"),
      'import {createRootAndRender,createRouter} from "@prinpo/stack/react"; import {routeTree} from "./routeTree.gen"; createRootAndRender(createRouter({routeTree}));',
    );
    await writeFile(
      join(app, "src/routes/__root.tsx"),
      'import {createRootRoute,Outlet} from "@prinpo/stack/react"; export const Route=createRootRoute({component:Outlet});',
    );
    await writeFile(
      join(app, "src/routes/index.tsx"),
      'import {createFileRoute} from "@prinpo/stack/react"; export const Route=createFileRoute("/")({component:()=> <p>Split route</p>});',
    );
    // An isolated install exposes bare imports emitted by the splitter.
    const bunfig = join(app, "bunfig.toml");
    await writeFile(bunfig, (await readFile(bunfig, "utf8")).replace('"hoisted"', '"isolated"'));
    await rm(join(app, "node_modules"), { recursive: true });
    command(["bun", "install"], app, installEnv);
    command(["bun", "run", "build"], app, installEnv);
    await access(join(app, "dist/client/index.html"));
    command([cli, "init", "no-editors"], root, installEnv);
    const plain = await readdir(join(root, "no-editors"));
    if (plain.includes(".zed") || plain.includes(".vscode"))
      throw new Error("Unattended initialization generated unsolicited editor settings");
  } finally {
    if (registry && registry.exitCode === null && registry.signalCode === null) {
      registry.kill("SIGTERM");
      await once(registry, "exit");
    }
    await rm(root, { recursive: true, force: true });
  }
}
