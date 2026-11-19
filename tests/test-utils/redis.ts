import { spawnSync } from "node:child_process";

/** Each suite owns its ephemeral datastore; no application Redis data is touched. */
export function testRedis() {
  const external = process.env.STACK_TEST_REDIS_URL;
  if (external) return { connection: { url: external }, close() {} };
  const run = (...args: string[]) => {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0)
      throw new Error(
        `Redis tests require Docker or STACK_TEST_REDIS_URL. ${result.error?.message ?? result.stderr}`,
      );
    return result.stdout.trim();
  };
  const id = run(
    "run",
    "--detach",
    "--rm",
    "-p",
    "127.0.0.1::6379",
    "redis:8.2-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  );
  try {
    const deadline = Date.now() + 10_000;
    while (true) {
      const ready = spawnSync("docker", ["exec", id, "redis-cli", "ping"], {
        encoding: "utf8",
        timeout: 2000,
      });
      if (ready.status === 0 && ready.stdout.trim() === "PONG") break;
      if (Date.now() >= deadline) throw new Error("Ephemeral Redis did not become ready");
    }
    let closed = false;
    const address = run("port", id, "6379/tcp");
    const port = Number(address.split(":").at(-1));
    return {
      connection: { host: "127.0.0.1", port },
      close: () => {
        if (!closed) {
          closed = true;
          run("rm", "--force", id);
        }
      },
    };
  } catch (error) {
    run("rm", "--force", id);
    throw error;
  }
}
