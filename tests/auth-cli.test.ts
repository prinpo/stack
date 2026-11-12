import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function run(cwd: string, ...args: string[]) {
  return spawnSync("bun", ["--no-env-file", resolve("src/cli/main.ts"), ...args], {
    cwd,
    env: { ...process.env, NODE_ENV: "development", NO_COLOR: "1", BETTER_AUTH_TELEMETRY: "0" },
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("auth schema generation bootstraps offline and detects plugin schema drift", async () => {
  const root = await mkdtemp(join(process.cwd(), ".stack-test-auth-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src/auth.ts"),
    `import { drizzleAdapter } from "@prinpo/stack/auth/adapters/drizzle";\nimport { organization } from "@prinpo/stack/auth/plugins/organization";\nexport const authOptions = { database: drizzleAdapter({}, { provider: "sqlite" }), plugins: [organization()] };`,
  );
  const generated = run(root, "auth", "generate");
  expect(generated.status, generated.stdout + generated.stderr).toBe(0);
  const output = await readFile(join(root, "src/db/auth.generated.ts"), "utf8");
  expect(output).toContain("defineRelationsPart");
  expect(output).toContain("organization");
  expect(output).toContain("references");
  expect(output).toContain("index(");
  expect(run(root, "auth", "check").status).toBe(0);
  await writeFile(join(root, "src/db/auth.generated.ts"), output + "\n// changed\n");
  expect(run(root, "auth", "check").status).toBe(1);
  expect(run(root, "auth", "generate").status).toBe(1);
  expect(run(root, "auth", "generate", "--yes").status).toBe(0);
});

test("doctor inspects auth files without evaluating config and accepts custom paths", async () => {
  const root = await mkdtemp(join(process.cwd(), ".stack-test-auth-doctor-"));
  roots.push(root);
  await mkdir(join(root, "src/server"), { recursive: true });
  await writeFile(join(root, "src/server/index.ts"), "");
  await writeFile(join(root, "src/auth.ts"), 'throw new Error("doctor must not execute this")');
  const missing = run(root, "doctor", "--json");
  expect(missing.status).toBe(1);
  expect(JSON.parse(missing.stdout).auth).toMatchObject({ enabled: true, ready: false });
  await writeFile(join(root, "custom-schema.ts"), "export {};");
  const ready = run(root, "doctor", "--json", "--auth-schema", "custom-schema.ts");
  expect(ready.status, ready.stdout + ready.stderr).toBe(0);
  expect(JSON.parse(ready.stdout).auth).toMatchObject({ enabled: true, ready: true });
});
