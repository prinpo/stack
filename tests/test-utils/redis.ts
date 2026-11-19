import { RedisClient } from "bun";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestRedis {
  connection: { url: string } | { host: string; port: number };
  close(): void | Promise<void>;
}

async function startRedisProcess(binary: string) {
  const directory = await mkdtemp(join(tmpdir(), "stack-redis-"));
  const socket = join(directory, "redis.sock");
  const connection = { url: `redis+unix://${socket}` };
  let server: Bun.Subprocess | undefined;
  const close = async () => {
    if (server) {
      if (server.exitCode === null) server.kill();
      await server.exited;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    server = Bun.spawn(
      [binary, "--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"],
      { cwd: directory, stdout: "ignore", stderr: "inherit" },
    );
    const deadline = Date.now() + 10_000;
    while (server.exitCode === null && Date.now() < deadline) {
      const client = new RedisClient(connection.url, { autoReconnect: false });
      try {
        if ((await client.ping()) === "PONG") return { connection, close };
      } catch {
        // Redis may still be creating its socket.
      } finally {
        client.close();
      }
      await Bun.sleep(25);
    }
    throw new Error(`Test redis-server did not become ready (exit code: ${server.exitCode})`);
  } catch (error) {
    await close();
    throw error;
  }
}

/** Each suite owns its ephemeral datastore; no application Redis data is touched. */
export async function testRedis(): Promise<TestRedis> {
  const external = process.env.STACK_TEST_REDIS_URL;
  if (external) return { connection: { url: external }, close() {} };
  if (process.env.STACK_TEST_REDIS_SERVER)
    return startRedisProcess(process.env.STACK_TEST_REDIS_SERVER);
  const run = (...args: string[]) => {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0)
      throw new Error(
        `Redis tests require Docker, STACK_TEST_REDIS_SERVER or STACK_TEST_REDIS_URL. ${result.error?.message ?? result.stderr}`,
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
