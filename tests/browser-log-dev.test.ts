import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";

import { stopProcessGroup } from "../src/processes";

async function port() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

test("stack dev broadcasts explicit server logs through Vite to every connected browser", async () => {
  const root = await mkdtemp(join(process.cwd(), ".stack-test-browser-log-"));
  const apiPort = await port();
  const vitePort = await port();
  await mkdir(join(root, "src/server"), { recursive: true });
  await mkdir(join(root, "src/routes"));
  await writeFile(
    join(root, "src/routes/__root.tsx"),
    'import {createRootRoute} from "@prinpo/stack/react"; export const Route=createRootRoute();',
  );
  await writeFile(join(root, "src/index.html"), "<html><head></head><body>logs</body></html>");
  await writeFile(
    join(root, "vite.config.ts"),
    `import {stack} from "@prinpo/stack/vite"; export default {plugins:[stack({api:true})],server:{host:"127.0.0.1",port:${vitePort}}};`,
  );
  await writeFile(
    join(root, "src/server/index.ts"),
    `import {Elysia} from "@prinpo/stack/server"; import {browserLog} from "@prinpo/stack/browser-log"; new Elysia().get("/api/log",()=>{browserLog("broadcast-check");return "ok"}).listen(${apiPort});`,
  );
  const child = spawn("bun", ["--no-env-file", resolve("src/cli/main.ts"), "dev"], {
    cwd: root,
    env: { ...process.env, PORT: String(apiPort), NODE_ENV: "development", NO_COLOR: "1" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const sockets: WebSocket[] = [];
  try {
    const origin = `http://127.0.0.1:${vitePort}`;
    let source = "";
    for (let i = 0; i < 100; i++) {
      try {
        source = await (await fetch(origin + "/@vite/client")).text();
        if (source.includes("wsToken")) break;
      } catch {
        /* readiness */
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    const token = source.match(/const wsToken = "([^"]+)"/)?.[1];
    expect(token, output + source.slice(-500)).toBeTruthy();
    const messages: Promise<string>[] = [];
    for (let i = 0; i < 2; i++) {
      const socket = new WebSocket(`ws://127.0.0.1:${vitePort}/?token=${token}`, "vite-hmr");
      sockets.push(socket);
      await new Promise<void>((done, reject) => {
        socket.addEventListener("open", () => done());
        socket.addEventListener("error", reject);
      });
      messages.push(
        new Promise((done, reject) => {
          const timer = setTimeout(() => reject(new Error(output + "\nNo browser log")), 3000);
          socket.addEventListener("message", (event) => {
            if (String(event.data).includes("broadcast-check")) {
              clearTimeout(timer);
              done(String(event.data));
            }
          });
        }),
      );
    }
    expect(await (await fetch(origin + "/api/log")).text()).toBe("ok");
    for (const message of await Promise.all(messages))
      expect(message).toContain("stack:browser-log");
    expect(output).toContain("broadcast-check");
    expect(await (await fetch(origin)).text()).toContain("__stack_browser_log");
  } finally {
    sockets.forEach((socket) => socket.close());
    await stopProcessGroup(child);
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
