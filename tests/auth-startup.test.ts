import { spawnSync } from "node:child_process";
import { expect, test } from "vite-plus/test";

test("standard startup rejects missing production delivery before opening a listener", () => {
  const result = spawnSync(
    "bun",
    [
      "--no-env-file",
      "--eval",
      `
import { betterAuth, createAuthHelpers } from "@prinpo/stack/auth";
import { magicLink } from "@prinpo/stack/auth/plugins";
import { Elysia, startServer } from "@prinpo/stack/server";
const auth=betterAuth({baseURL:"https://example.com",secret:"a-strong-production-test-secret-more-than-32-chars",plugins:[magicLink()]});
const app=new Elysia().use(createAuthHelpers(auth).elysia());
await startServer(async()=>({app}),{env:{client:false}});
`,
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, NODE_ENV: "production", VARLOCK_TELEMETRY_DISABLED: "1" },
    },
  );
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stderr).toContain("requires an application sender");
  expect(result.stdout).not.toContain("API listening");
});
