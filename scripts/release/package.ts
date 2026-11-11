import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { devDependencies } from "../../package.json";
import { generateDatabaseExports } from "../generate-database-exports";

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
    await generateDatabaseExports(join(stage, "src/database/generated"));
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
import { eq, sql, defineRelations } from "@prinpo/stack/database";
import { eq as upstreamEq } from "drizzle-orm";
import { loadServerEnv } from "@prinpo/stack/env/server";
import { isStructuredApiError } from "@prinpo/stack/logger/client";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let reactInstalled = false;
try { require.resolve("react"); reactInstalled = true; } catch {}
if (reactInstalled) throw new Error("Backend-only validation must run without React");
const pkg = await import("@prinpo/stack/package.json");
if (pkg.version !== ${JSON.stringify(version)}) throw new Error("Wrong package version");
if(eq !== upstreamEq || typeof sql !== "function" || typeof defineRelations !== "function") throw new Error("Broken database core forwarding");
for (const path of Object.keys(pkg.exports).filter(path=>!path.includes("*"))) require.resolve("@prinpo/stack" + path.slice(1));
const upstreamRoot=dirname(require.resolve("drizzle-orm"));
for(const path of new Bun.Glob("**/*.js").scanSync({cwd:upstreamRoot,onlyFiles:true})) {
  if(!path.split("/").includes("node_modules")) require.resolve("@prinpo/stack/database/"+path.slice(0,-3));
}
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
    await mkdir(join(consumer, "src"), { recursive: true });
    await writeFile(
      join(consumer, "src/index.html"),
      '<div id="root"></div><script type="module" src="/main.tsx"></script>',
    );
    await writeFile(
      join(consumer, "src/main.tsx"),
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
    await validateDatabaseConsumer(consumer, cli, env);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

/** Qualify native Drizzle imports and source-free production migration in a packed consumer. */
async function validateDatabaseConsumer(consumer: string, cli: string, env: NodeJS.ProcessEnv) {
  const manifest = JSON.parse(await readFile(join(consumer, "package.json"), "utf8"));
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      ...manifest,
      devDependencies: {
        "@types/bun": devDependencies["@types/bun"],
        typescript: devDependencies.typescript,
      },
    }),
  );
  command(["bun", "install", "--ignore-scripts"], consumer, env);
  await mkdir(join(consumer, "env/server"), { recursive: true });
  await mkdir(join(consumer, "src/server"), { recursive: true });
  await writeFile(
    join(consumer, "env/server/.env.schema"),
    "# @redact=false @preventLeaks=false\n# ---\n# @dynamic\nDATABASE_URL=sqlite://consumer.sqlite\n",
  );
  await writeFile(
    join(consumer, "drizzle.config.ts"),
    `import {defineConfig} from "@prinpo/stack/database"; import {ENV} from "@prinpo/stack/env"; export default defineConfig({dialect:"sqlite",schema:"./schema.ts",dbCredentials:{url:ENV.DATABASE_URL}});`,
  );
  await writeFile(
    join(consumer, "schema.ts"),
    `import {sqliteTable,integer,text} from "@prinpo/stack/database/sqlite-core"; export const notes=sqliteTable("notes",{id:integer().primaryKey(),text:text().notNull()});`,
  );
  await writeFile(
    join(consumer, "database.types.ts"),
    `import {defineRelations, type InferSelectModel} from "@prinpo/stack/database";
import {drizzle} from "@prinpo/stack/database/bun-sql/sqlite";
import {defineConfig} from "@prinpo/stack/database";
import {createInsertSchema} from "@prinpo/stack/database/zod";
import {notes} from "./schema";
const validation=createInsertSchema(notes).pick({text:true});
const parsed:{text:string}=validation.parse({text:"typed"});void parsed;
const config=defineConfig({dialect:"sqlite",schema:"./schema.ts"});
const output:"./migrations"=config.out;void output;
// @ts-expect-error Migration output belongs to Stack.
defineConfig({dialect:"sqlite",out:"./other"});
const db=drizzle.mock({relations:defineRelations({notes})});
const row:InferSelectModel<typeof notes>={id:1,text:"typed"};
const expected:{id:number;text:string}=row;
const result:Promise<typeof expected[]>=db.query.notes.findMany().execute();
void result;
// @ts-expect-error Native schema inference rejects a numeric note.
db.insert(notes).values({text:42});
`,
  );
  command(
    [
      join(consumer, "node_modules/.bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "esnext",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--types",
      "bun",
      "database.types.ts",
    ],
    consumer,
    env,
  );
  await writeFile(
    join(consumer, "src/server/index.ts"),
    `import {createServer} from "node:net";
import {once} from "node:events";
import {SQL} from "bun";
import {drizzle} from "@prinpo/stack/database/bun-sql/sqlite";
import {defineRelations} from "@prinpo/stack/database";
import {createInsertSchema} from "@prinpo/stack/database/zod";
import {Elysia,startServer} from "@prinpo/stack/server";
import {ENV} from "@prinpo/stack/env";
import {notes} from "../../schema";
const probe=createServer(); probe.listen(0,"127.0.0.1"); await once(probe,"listening");
const address=probe.address(); if(!address || typeof address==="string") throw new Error("No port");
process.env.PORT=String(address.port); await new Promise<void>(done=>probe.close(()=>done()));
const app=await startServer(async()=>{
const client=new SQL(ENV.DATABASE_URL); const db=drizzle({client,relations:defineRelations({notes})});
await db.insert(notes).values({id:1,text:"packed database"}).onConflictDoNothing();
return {app:new Elysia().get("/api/notes",()=>db.query.notes.findMany()).post("/api/validate",({body})=>body,{body:createInsertSchema(notes).pick({text:true})}).onStop(async()=>{await client.close();})};
},{env:{client:false}});
try { const rows=await (await fetch(new URL("/api/notes",app.server!.url))).json();
if(JSON.stringify(rows)!==JSON.stringify([{id:1,text:"packed database"}])) throw new Error("Broken packed database");
const validated=await fetch(new URL("/api/validate",app.server!.url),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:"valid",id:99})});
if(JSON.stringify(await validated.json())!==JSON.stringify({text:"valid"})) throw new Error("Broken forwarded Zod validation");
} finally {await app.stop();}
`,
  );
  command([cli, "db", "generate", "--name", "initial"], consumer, env);
  command([cli, "build"], consumer, env);
  for (const name of ["src/server", "schema.ts", "drizzle.config.ts", "migrations"])
    await rm(join(consumer, name), { recursive: true });
  command([cli, "start"], consumer, env);
  command(["bun", "--no-env-file", "dist/server/index.js"], consumer, {
    ...env,
    NODE_ENV: "production",
  });
}

if (import.meta.main) {
  const output = resolve(process.argv[2] ?? "dist/package");
  const manifest = await Bun.file("package.json").json();
  const tarball = await preparePackage(process.cwd(), output, manifest.version);
  await validatePackage(tarball, manifest.version);
  console.log(`Validated ${tarball}`);
}
