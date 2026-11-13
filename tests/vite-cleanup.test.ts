import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

test("Vite shutdown does not recreate a removed application fixture", async () => {
  const root = await createTestDirectory("cleanup");
  try {
    // Inspect after process exit: optimizer writes can outlive both server.close() and rm().
    const result = spawnSync(
      "bun",
      [
        "--no-env-file",
        "--eval",
        `import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import { stack } from ${JSON.stringify(resolve("src/vite.ts"))};
import { closeViteServer } from ${JSON.stringify(resolve("tests/test-utils/vite-server.ts"))};
const root = process.argv[1];
await mkdir(join(root, "src/routes"), { recursive: true });
await writeFile(join(root, "src/routes/__root.tsx"), 'import { createRootRoute } from "@prinpo/stack/react"; export const Route = createRootRoute();');
await writeFile(join(root, "src/index.html"), "<html><head></head><body>fixture</body></html>");
const server = await createServer({ configFile: false, root, plugins: [stack()], server: { host: "127.0.0.1", port: 0 } });
try {
  await server.listen();
  await (await fetch(server.resolvedUrls.local[0])).text();
} finally {
  await closeViteServer(server);
  await rm(root, { recursive: true, force: true });
}`,
        root,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(existsSync(root), "Optimizer writes recreated the removed fixture").toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
