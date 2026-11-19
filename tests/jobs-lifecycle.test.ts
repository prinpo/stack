import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";
import { type TestRedis, testRedis } from "./test-utils/redis";

let redis: TestRedis;
beforeAll(async () => {
  redis = await testRedis();
}, 60_000);
afterAll(() => redis?.close());

test("startup is idempotent and shutdown bounds active work while aborting its signal", () => {
  const source = `
import { createWorkerRuntime as createJobs } from "./src/jobs/runtime";
import { defineJob, defineQueue, z } from "@prinpo/stack/jobs";
let entered;
const active = new Promise(resolve => { entered = resolve; });
let aborted = false;
const queues = { work: defineQueue(${JSON.stringify(`shutdown-${crypto.randomUUID()}`)}, { jobs: {
  hold: defineJob({input:z.string(), handler:async (job,token,signal)=>{
    entered();
    await new Promise(resolve=>signal.addEventListener("abort",()=>{aborted=true;resolve();},{once:true}));
    return job.data;
  }})
}}) };
const runtime=createJobs({queues,connection:${JSON.stringify(redis.connection)},logging:false,shutdownTimeoutMs:50,onError:()=>{}});
await Promise.all([runtime.start(),runtime.start()]);
await runtime.client.work.add.hold("hello");
await active;
const start=Date.now();
await runtime.close();
await runtime.close();
console.log(JSON.stringify({aborted,elapsed:Date.now()-start}));
`;
  const result = spawnSync("bun", ["--no-env-file", "--eval", source], {
    encoding: "utf8",
    timeout: 3000,
  });
  expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(0);
  const report = JSON.parse(result.stdout.trim());
  expect(report.aborted).toBe(true);
  expect(report.elapsed).toBeLessThan(1500);
});

test("unavailable Redis fails startup within its deadline and releases connection resources", () => {
  const source = `
import {createJobs,defineJob,defineQueue,z} from "@prinpo/stack/jobs";
const runtime=createJobs({connection:{host:"127.0.0.1",port:1},startupTimeoutMs:50,onError:()=>{},queues:{work:defineQueue("unavailable",{jobs:{echo:defineJob({input:z.string(),handler:async job=>job.data})}})}});
try{await runtime.start();throw new Error("Unexpected readiness");}catch(error){console.log(error.message);}
await runtime.close();
`;
  const result = spawnSync("bun", ["--no-env-file", "--eval", source], {
    encoding: "utf8",
    timeout: 2000,
  });
  expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(0);
  expect(result.stdout).toMatch(/startup timeout|Connection.*closed/i);
});

test("standard backend startup registers shared jobs before listening and app stop closes them", async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const source = `
import {Elysia,startServer} from "@prinpo/stack/server";
import {createJobsClient} from "@prinpo/stack/jobs/client";
import {jobsPlugin} from "@prinpo/stack/jobs/elysia";
import {defineJob,defineQueue,z} from "@prinpo/stack/jobs";
const queues={work:defineQueue(${JSON.stringify(`plugin-${crypto.randomUUID()}`)},{jobs:{echo:defineJob({input:z.string(),handler:async job=>({echo:job.data})})}})};
const setup=new Elysia({name:"test:setup"}).use(jobsPlugin({queues,connection:${JSON.stringify(redis.connection)}}));
const routes=new Elysia().use(setup).get("/echo",({jobs})=>jobs.work.add.echo("hello").then(async job=>({state:await job.getState()})));
const app=new Elysia().use(setup).use(routes);
await startServer(async()=>({app}),{env:{client:false}});
console.log(JSON.stringify(await (await app.handle(new Request("http://localhost/echo"))).json()));
await app.stop();
try{await createJobsClient().work.add.echo("closed");throw new Error("Unexpected registration");}catch(error){console.log(error.message);}
`;
  const result = spawnSync("bun", ["--no-env-file", "--eval", source], {
    encoding: "utf8",
    timeout: 3000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      VARLOCK_TELEMETRY_DISABLED: "1",
    },
  });
  expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(0);
  expect(result.stdout).toContain('"state":"waiting"');
  expect(result.stdout).toContain("not started");
});

test("managed development termination respects the profile's jobs grace period without resolving other credentials", async () => {
  const cwd = await createTestDirectory("jobs-dev");
  await mkdir(join(cwd, "src/server"), { recursive: true });
  await mkdir(join(cwd, "env/server"), { recursive: true });
  await writeFile(
    join(cwd, "env/server/.env.schema"),
    "# @redact=false @preventLeaks=false\n# ---\n# @dynamic @required\nUNRELATED=exec(`exit 97`)\n",
  );
  await writeFile(join(cwd, "env/server/.env.development"), "JOBS_SHUTDOWN_TIMEOUT_MS=3000\n");
  await writeFile(
    join(cwd, "src/server/index.ts"),
    `
process.on("SIGTERM",async()=>{await Bun.sleep(2300);console.log("drained");process.exit(0);});
console.log("ready");setInterval(()=>{},1000);
`,
  );
  const child = spawn("bun", ["--no-env-file", resolve("src/cli/main.ts"), "dev"], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", VARLOCK_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    await expect.poll(() => output).toContain("ready");
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
    expect(output).toContain("drained");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(cwd, { recursive: true, force: true });
  }
}, 10_000);

test.skipIf(Boolean(process.env.STACK_TEST_REDIS_URL))(
  "producer waits and resource cleanup stay bounded when Redis disappears after startup",
  async () => {
    const datastore = await testRedis();
    const source = `
import {createJobs,defineJob,defineQueue,z} from "@prinpo/stack/jobs";
const runtime=createJobs({queues:{work:defineQueue(${JSON.stringify(`outage-${crypto.randomUUID()}`)},{jobs:{echo:defineJob({input:z.string(),handler:async job=>job.data})}})},connection:${JSON.stringify(datastore.connection)},operationTimeoutMs:50,shutdownTimeoutMs:50,onError:()=>{}});
await runtime.start();console.log("ready");await Bun.stdin.text();
try{await runtime.client.work.add.echo("hello");}catch(error){console.log(error.message);}
await runtime.close();console.log("closed");
`;
    const child = spawn("bun", ["--no-env-file", "--eval", source], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    try {
      await expect.poll(() => output).toContain("ready");
      await datastore.close();
      child.stdin.end("continue");
      await expect.poll(() => output, { timeout: 2000 }).toContain("closed");
      // BullMQ's already scheduled connection-error retry timer can take five seconds to expire.
      try {
        await expect.poll(() => child.exitCode, { timeout: 7000 }).toBe(0);
      } catch (error) {
        throw new Error(output, { cause: error });
      }
      expect(output).toMatch(/enqueue timeout|Connection.*closed/i);
      expect(output).toContain("closed");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
      await datastore.close();
    }
  },
  10_000,
);

test("standard signal shutdown exits within its budget even when a handler ignores cancellation", async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const source = `
import {startJobsWorker,defineJob,defineQueue,z} from "@prinpo/stack/jobs";
let entered;const active=new Promise(resolve=>{entered=resolve;});
const queues={work:defineQueue(${JSON.stringify(`signal-${crypto.randomUUID()}`)},{jobs:{hold:defineJob({input:z.string(),handler:async job=>{entered();await Bun.sleep(10000);return job.data;}})}})};
const runtime=await startJobsWorker(async()=>({jobs:{queues,connection:${JSON.stringify(redis.connection)}}}));
await runtime.client.work.add.hold("hello");await active;process.kill(process.pid,"SIGTERM");
`;
  const result = spawnSync("bun", ["--no-env-file", "--eval", source], {
    encoding: "utf8",
    timeout: 4000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      JOBS_SHUTDOWN_TIMEOUT_MS: "50",
      VARLOCK_TELEMETRY_DISABLED: "1",
    },
  });
  expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(143);
});

test("a termination signal during worker startup closes acquired resources once", async () => {
  const cwd = await createTestDirectory("worker-interrupt");
  try {
    await writeFile(
      join(cwd, "worker.ts"),
      `
      import {startJobsWorker,defineQueue,defineJobContext,z} from "@prinpo/stack/jobs";
      const job=defineJobContext(async resources=>{
        resources.defer(()=>console.log("dependencies closed"));
        process.kill(process.pid,"SIGTERM");
        await Bun.sleep(50);
        return {};
      });
      await startJobsWorker(async()=>({jobs:{connection:${JSON.stringify(redis.connection)},queues:{work:defineQueue("startup-interrupt",{jobs:{test:job({input:z.string(),handler:job=>job.data})}})}}}));
    `,
    );
    const child = spawnSync("bun", ["--no-env-file", "worker.ts"], {
      cwd,
      encoding: "utf8",
      timeout: 3000,
    });
    expect(child.status, child.stderr).toBe(143);
    expect(child.stdout.trim().split("\n")).toEqual(["dependencies closed"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
