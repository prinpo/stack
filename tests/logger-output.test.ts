import { type DrainContext } from "@prinpo/stack/logger";
import { logger } from "@prinpo/stack/logger/elysia";
import { Elysia } from "@prinpo/stack/server";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

test("development persistence rotates bounded files readable by local tools", async () => {
  const dir = await createTestDirectory("log-output");
  const events: DrainContext[] = [];
  const app = new Elysia()
    .use(
      logger({
        silent: true,
        persistence: { dir, maxFiles: 2, maxSizePerFile: 1 },
        drain: (ctx) => {
          events.push(ctx);
        },
      }),
    )
    .get("/:id", ({ log, params }) => {
      log.set({ order: params.id });
      return { ok: true };
    });
  try {
    for (let i = 0; i < 4; i++) {
      await app.handle(new Request(`http://localhost/${i}`));
      await vi.waitFor(() => expect(events).toHaveLength(i + 1));
    }
    const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
    expect(files).toHaveLength(2);
    const saved = (await Promise.all(files.map((file) => readFile(join(dir, file), "utf8")))).join(
      "\n",
    );
    expect(saved).toContain('"order":"3"');
    expect(saved).not.toContain('"order":"0"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("production uses native JSON stdout without creating development files", async () => {
  const dir = await createTestDirectory("log-prod");
  vi.stubEnv("NODE_ENV", "production");
  const output = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const app = new Elysia()
      .use(logger({ service: "production", persistence: { dir } }))
      .get("/health", () => "ok");
    await app.handle(new Request("http://localhost/health"));
    await vi.waitFor(() => expect(output).toHaveBeenCalled());
    const line: unknown = output.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    if (typeof line !== "string") throw new Error("Expected JSON output");
    expect(JSON.parse(line)).toMatchObject({ service: "production", status: 200, path: "/health" });
    expect(await readdir(dir)).toEqual([]);
  } finally {
    output.mockRestore();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
