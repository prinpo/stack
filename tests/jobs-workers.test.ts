import {
  createJobs,
  defineJob,
  defineJobContext,
  defineQueue,
  withStoredResult,
  z,
} from "@prinpo/stack/jobs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { createWorkerRuntime } from "../src/jobs/runtime";
import { createTestDirectory } from "./test-utils/directory";
import { testRedis } from "./test-utils/redis";

let redis: ReturnType<typeof testRedis>;
beforeAll(() => {
  redis = testRedis();
}, 60_000);
afterAll(() => redis?.close());

test("producer runtimes leave work queued until a selected worker starts", async () => {
  const queues = {
    work: defineQueue(crypto.randomUUID(), {
      jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
    }),
    other: defineQueue(crypto.randomUUID(), {
      jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
    }),
  };
  const producer = createJobs({
    name: crypto.randomUUID(),
    queues,
    connection: redis.connection,
    logging: false,
  });
  const worker = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues: { work: queues.work },
    connection: redis.connection,
    logging: false,
  });
  try {
    await producer.start();
    const queued = await producer.client.work.add.echo("hello");
    const untouched = await producer.client.other.add.echo("other");
    expect(await queued.getState()).toBe("waiting");
    await worker.start();
    await expect
      .poll(async () => (await producer.client.work.getJob(queued.id!))?.returnvalue)
      .toBe("hello");
    expect(await untouched.getState()).toBe("waiting");
  } finally {
    await worker.close();
    await producer.close();
  }
});

test("jobs across queues share worker dependencies and receive separate attempt loggers", async () => {
  const db = { value: "shared" };
  let opened = 0;
  let closed = 0;
  const loggers = new Set();
  const appJob = defineJobContext((resources) => {
    opened++;
    resources.defer(() => {
      closed++;
    });
    return { db };
  });
  const job = appJob({
    input: z.string(),
    handler: (job, context) => {
      expect(context.db).toBe(db);
      expect(context.logger).toBe(job.logger);
      loggers.add(context.logger);
      return context.db.value + job.data;
    },
  });
  const queues = {
    first: defineQueue(crypto.randomUUID(), { jobs: { job } }),
    second: defineQueue(crypto.randomUUID(), { jobs: { job } }),
  };
  const options = { queues, connection: redis.connection, logging: false };
  const producer = createJobs({ ...options, name: crypto.randomUUID() });
  const worker = createWorkerRuntime({ ...options, name: crypto.randomUUID() });
  try {
    await producer.start();
    expect(opened).toBe(0);
    await worker.start();
    expect(opened).toBe(1);
    const results = await Promise.all([
      producer.client.first.run.job("-1", { timeoutMs: 5000 }),
      producer.client.second.run.job("-2", { timeoutMs: 5000 }),
    ]);
    expect(results).toEqual(["shared-1", "shared-2"]);
    expect(loggers.size).toBe(2);
    expect(closed).toBe(0);
  } finally {
    await worker.close();
    await producer.close();
  }
  expect(closed).toBe(1);
});

test.each(["worker", "process", "thread"])(
  "portable handler progress, data, control flow and results in %s mode",
  async (mode) => {
    const cwd = await createTestDirectory("jobs-sandbox");
    try {
      await writeFile(
        join(cwd, "work-queue.ts"),
        `
import {defineJob,defineQueue,WaitingError} from '@prinpo/stack/jobs';
import {z} from '@prinpo/stack/jobs';
import {isMainThread} from 'node:worker_threads';
export default defineQueue(${JSON.stringify(crypto.randomUUID())},{module:import.meta.url,worker:{sandbox:${JSON.stringify(mode === "worker" ? undefined : mode)}},jobs:{echo:defineJob({input:z.object({value:z.string().transform(Number)}),phases:['saved'],handler:async (job, token)=>{
  if (job.data.value===21) {
    await job.updateData({value:'22'});
    const ttl=await job.moveToWait(token);
    await Bun.write(new URL('./move-result',import.meta.url),typeof ttl);
    throw new WaitingError();
  }
  await job.updateData({value:'42'});await job.updateProgress({phase:'saved',percent:100});return {pid:process.pid,isMainThread,value:job.data.value,progress:job.progress,date:new Date('2026-01-01T00:00:00Z')};}})}});
`,
      );
      await writeFile(
        join(cwd, "run.ts"),
        `
import {startJobsWorker} from '@prinpo/stack/jobs';import queue from './work-queue';
const runtime=await startJobsWorker(async()=>({jobs:{queues:{work:queue},connection:${JSON.stringify(redis.connection)},logging:false}}));
try{const result=await runtime.client.work.run.echo({value:'21'},{timeoutMs:5000});console.log(JSON.stringify({parent:process.pid,result}));}finally{await runtime.close();}
`,
      );
      const process = spawnSync("bun", ["--no-env-file", join(cwd, "run.ts")], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(process.status, process.stdout + process.stderr + process.error?.message).toBe(0);
      const report = JSON.parse(process.stdout.trim().split("\n").at(-1)!);
      expect(await Bun.file(join(cwd, "move-result")).text()).toBe("undefined");
      expect(report.result.value).toBe(42);
      expect(report.result.progress).toEqual({ phase: "saved", percent: 100 });
      expect(report.result.date).toBe("2026-01-01T00:00:00.000Z");
      expect(report.result.isMainThread).toBe(mode !== "thread");
      expect(report.result.pid === report.parent).toBe(mode !== "process");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
  15_000,
);

test("sandbox settings without a processor module fail before opening connections", () => {
  expect(() =>
    createJobs({
      connection: redis.connection,

      queues: {
        work: defineQueue("invalid", {
          worker: { sandbox: "thread" },
          jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
        }),
      },
    }),
  ).toThrow("module: import.meta.url");
});

test("stored results are reused and canonical persistence precedes completion", async () => {
  let saved: { result: number } | undefined;
  let calls = 0;
  const execute = () =>
    withStoredResult({
      load: async () => saved,
      run: async () => ++calls,
      save: async (result) => {
        saved = { result };
        return result;
      },
    });
  expect(await execute()).toBe(1);
  expect(saved).toEqual({ result: 1 });
  expect(await execute()).toBe(1);
  expect(calls).toBe(1);
  await expect(
    withStoredResult({
      load: async () => undefined,
      run: async () => 42,
      save: async () => {
        throw new Error("database unavailable");
      },
    }),
  ).rejects.toThrow("database unavailable");
});

test.each(["start", "worker"] as const)(
  "%s artifacts preserve processor imports without application source",
  async (command) => {
    const cwd = await createTestDirectory("jobs-build");
    const cli = new URL("../src/cli/main.ts", import.meta.url).pathname;
    try {
      const files: Record<string, string> = {
        "tsconfig.base.json": JSON.stringify({
          compilerOptions: { baseUrl: "src", paths: { "@app/*": ["server/*"] } },
        }),
        "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),

        [command === "start" ? "src/server/index.ts" : "src/server/worker.ts"]:
          "import {startJobsWorker} from '@prinpo/stack/jobs';const runtime=await startJobsWorker(()=>import('./instance'));try{console.log(JSON.stringify(await runtime.client.work.run.echo('hello',{timeoutMs:3000,job:{attempts:2}})));}finally{await runtime.close();}\n",
        "src/server/instance.ts": `import {createJobs} from '@prinpo/stack/jobs';import queue from '@app/work-queue';export const jobs={queues:{work:queue},connection:${JSON.stringify(redis.connection)},logging:false};\n`,
        "src/server/work-queue.ts": `import {defineJob,defineQueue,z} from '@prinpo/stack/jobs';export default defineQueue(${JSON.stringify(crypto.randomUUID())},{module:import.meta.url,worker:{sandbox:'process'},jobs:{echo:defineJob({input:z.string(),handler:async job=>({text:job.data})})}});\n`,
      };
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(cwd, path, ".."), { recursive: true });
        await writeFile(join(cwd, path), content);
      }
      const built = spawnSync("bun", ["--no-env-file", cli, "build"], {
        cwd,
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(built.status, built.stdout + built.stderr).toBe(0);
      await rm(join(cwd, "src"), { recursive: true });
      await rm(join(cwd, "tsconfig.base.json"));
      await rm(join(cwd, "tsconfig.json"));
      const started = spawnSync("bun", ["--no-env-file", cli, command], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(started.status, started.stdout + started.stderr + started.error?.message).toBe(0);
      expect(JSON.parse(started.stdout.trim().split("\n").at(-1)!)).toEqual({ text: "hello" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
  30_000,
);

test.each([false, true])(
  "shutdown force-stops a noncooperative sandbox with useWorkerThreads=%s",
  async (useWorkerThreads) => {
    const cwd = await createTestDirectory("jobs-force");
    try {
      await writeFile(
        join(cwd, "work-queue.ts"),
        `import {defineJob,defineQueue,z} from '@prinpo/stack/jobs';export default defineQueue(${JSON.stringify(crypto.randomUUID())},{module:import.meta.url,worker:{sandbox:${JSON.stringify(useWorkerThreads ? "thread" : "process")}},jobs:{hold:defineJob({input:z.string(),handler:async job=>{await job.updateProgress({percent:10});await Bun.sleep(10000);return 'late';}})}});\n`,
      );
      await writeFile(
        join(cwd, "run.ts"),
        `import {createWorkerRuntime} from ${JSON.stringify(new URL("../src/jobs/runtime.ts", import.meta.url).href)};import queue from './work-queue';const runtime=createWorkerRuntime({queues:{work:queue},connection:${JSON.stringify(redis.connection)},logging:false,shutdownTimeoutMs:50});await runtime.start();const job=await runtime.client.work.add.hold('x');while((await runtime.client.work.getJob(job.id)).progress.percent!==10)await Bun.sleep(10);const start=Date.now();await runtime.close();console.log(JSON.stringify({elapsed:Date.now()-start}));\n`,
      );
      const result = spawnSync("bun", ["--no-env-file", join(cwd, "run.ts")], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(0);
      expect(JSON.parse(result.stdout.trim().split("\n").at(-1)!).elapsed).toBeLessThan(1000);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
  10000,
);

test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "shutdown covers processor bootstrap with threads=%s beforeSpawn=%s",
  async (useWorkerThreads, beforeSpawn) => {
    const cwd = await createTestDirectory("jobs-bootstrap");
    try {
      await writeFile(
        join(cwd, "work-queue.ts"),
        "await Bun.sleep(5000);export default async()=>{console.log('HANDLER_ESCAPED');return 'unexpected';};\n",
      );
      await writeFile(
        join(cwd, "run.ts"),
        `
import {createWorkerRuntime} from ${JSON.stringify(new URL("../src/jobs/runtime.ts", import.meta.url).href)};import {defineJob,defineQueue,Child,z,Queue} from '@prinpo/stack/jobs';
${beforeSpawn ? "const init=Child.prototype.init;Child.prototype.init=async function(){await Bun.sleep(100);return init.call(this);};" : ""}
const queue=defineQueue(${JSON.stringify(crypto.randomUUID())},{module:new URL('./work-queue.ts',import.meta.url).href,worker:{sandbox:${JSON.stringify(useWorkerThreads ? "thread" : "process")}},jobs:{hold:defineJob({input:z.string(),handler:async()=>''})}});
const runtime=createWorkerRuntime({queues:{work:queue},connection:${JSON.stringify(redis.connection)},logging:false,shutdownTimeoutMs:20});
const starting=runtime.start().catch(()=>{});await Bun.sleep(${beforeSpawn ? 5 : 100});
const start=Date.now();await runtime.close();await starting;console.log(JSON.stringify({elapsed:Date.now()-start}));

`,
      );
      const result = spawnSync("bun", ["--no-env-file", join(cwd, "run.ts")], {
        encoding: "utf8",
        timeout: 3000,
      });
      expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(0);
      const report = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      expect(report.elapsed).toBeLessThan(1000);
      expect(result.stdout).not.toContain("HANDLER_ESCAPED");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
  5000,
);

test("database results survive queue removal and a new worker/database connection", async () => {
  const cwd = await createTestDirectory("jobs-database");
  try {
    const factory = new URL(
      "../examples/fullstack/src/server/jobs/queues/utilities/save-message.ts",
      import.meta.url,
    ).href;
    const migration = new URL(
      "../examples/fullstack/migrations/20261116172604_jobs-results/migration.sql",
      import.meta.url,
    ).pathname;
    await mkdir(join(cwd, "env/server"), { recursive: true });
    await writeFile(
      join(cwd, "env/server/.env.schema"),
      "LOG_DIR=.evlog/logs\nDATABASE_URL=sqlite://results.sqlite\n",
    );
    await writeFile(
      join(cwd, "run.ts"),
      `
import {SQL} from 'bun';import {startJobsWorker,defineQueue} from '@prinpo/stack/jobs';
const url='sqlite://results.sqlite';let client=new SQL(url);await client.unsafe(await Bun.file(${JSON.stringify(migration)}).text());const operationId=crypto.randomUUID();const name=crypto.randomUUID();
async function execute(text){
  const runtime=await startJobsWorker(async()=>({jobs:{connection:${JSON.stringify(redis.connection)},logging:false,queues:{work:defineQueue(name,{jobs:{save:(await import(${JSON.stringify(factory)})).saveMessage}})}}}));
  try{return await runtime.client.work.run.save({operationId,text},{timeoutMs:3000,job:{removeOnComplete:true}});}finally{await runtime.close();}
}
const first=await execute('first');await client.close();client=new SQL(url);const second=await execute('changed');const rows=await client.unsafe('select * from job_results');await client.close();console.log(JSON.stringify({first,second,count:rows.length}));
`,
    );
    const result = spawnSync("bun", ["--no-env-file", join(cwd, "run.ts")], {
      cwd,
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status, result.stdout + result.stderr + result.error?.message).toBe(0);
    const report = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(report.count).toBe(1);
    expect(report.second).toEqual(report.first);
    expect(report.first.text).toBe("FIRST");
    expect(report.first.createdAt).toEqual(expect.any(String));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 15000);

test("native worker pause and resume preserves the blocking connection lifecycle", async () => {
  const queues = {
    work: defineQueue(crypto.randomUUID(), {
      jobs: { echo: defineJob({ input: z.string(), handler: async (job) => job.data }) },
    }),
  };
  const runtime = createWorkerRuntime({
    name: crypto.randomUUID(),
    queues,
    connection: redis.connection,
    logging: false,
  });
  try {
    await runtime.start();
    const worker = runtime.native("work").worker!;
    await worker.pause();
    const queued = await runtime.client.work.add.echo("queued while paused");
    expect(await queued.getState()).toBe("waiting");
    await worker.resume();
    expect(await runtime.client.work.run.echo("resumed", { timeoutMs: 1000 })).toBe("resumed");
  } finally {
    await runtime.close();
  }
});

test("stack dev starts a separate worker, drains it and runs the edited module", async () => {
  const cwd = await createTestDirectory("jobs-dev-reload");
  const cli = new URL("../src/cli/main.ts", import.meta.url).pathname;
  const queue = crypto.randomUUID();
  const shared = join(cwd, "src/job-version.ts");
  const source = `
    import {defineQueue,defineJob,z} from '@prinpo/stack/jobs';
    import {version} from '../job-version';
    export default defineQueue('${queue}',{jobs:{work:defineJob({
      input:z.boolean(), load:async resources=>{
        resources.defer(()=>Bun.write('disposed-'+version,'yes').then(()=>{}));
        return async job=>{
          if(job.data) {
            await Bun.write('worker-pid',String(process.pid));
            while(!await Bun.file('release').exists()) await Bun.sleep(10);
          }
          return version;
        };
      }
    })}});
  `;
  const producer = createJobs({
    name: queue,
    queues: {
      test: defineQueue(queue, {
        jobs: { work: defineJob({ input: z.boolean(), handler: () => 0 }) },
      }),
    },
    connection: redis.connection,
  });
  await mkdir(join(cwd, "src/server"), { recursive: true });
  await writeFile(shared, "export const version = 1");
  await writeFile(join(cwd, "src/server/test-queue.ts"), source);
  const common = `import test from './test-queue';export const jobs={queues:{test},connection:${JSON.stringify(redis.connection)},logging:false};`;
  await writeFile(join(cwd, "src/server/host.ts"), common);
  await writeFile(
    join(cwd, "src/server/worker.ts"),
    "import {startJobsWorker} from '@prinpo/stack/jobs';await startJobsWorker(()=>import('./host'));",
  );
  await writeFile(
    join(cwd, "src/server/index.ts"),
    "import {jobs} from './host';import {createJobs} from '@prinpo/stack/jobs'; const runtime=createJobs(jobs);await runtime.start();if(runtime.native('test').worker)throw new Error('HTTP consumed work');process.on('SIGTERM',async()=>{await Bun.write('http-stopping','yes');await runtime.close();process.exit(0)});await Bun.write('http-pid',String(process.pid));setInterval(()=>{},1000);",
  );
  const child = Bun.spawn(["bun", "--no-env-file", cli, "dev"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  try {
    await producer.start();
    const held = producer.client.test.run.work(true, { timeoutMs: 12000 });
    void held.catch(() => {});
    const httpPid = join(cwd, "http-pid");
    const workerPid = join(cwd, "worker-pid");
    await expect
      .poll(() => existsSync(httpPid) && existsSync(workerPid), { timeout: 5000 })
      .toBe(true);
    expect(await Bun.file(workerPid).text()).not.toBe(await Bun.file(httpPid).text());
    const stopping = join(cwd, "http-stopping");
    await writeFile(join(cwd, "src/browser-only.tsx"), "export const title = 'Updated'");
    await Bun.sleep(300);
    expect(existsSync(stopping)).toBe(false);
    await writeFile(shared, "export const version = 2");
    await expect.poll(() => existsSync(stopping), { timeout: 5000 }).toBe(true);
    await writeFile(join(cwd, "release"), "yes");
    expect(await held).toBe(1);
    await expect
      .poll(() => Bun.file(join(cwd, "disposed-1")).exists(), { timeout: 5000 })
      .toBe(true);
    expect(await producer.client.test.run.work(false, { timeoutMs: 5000 })).toBe(2);
  } finally {
    await writeFile(join(cwd, "release"), "yes");
    child.kill("SIGTERM");
    await child.exited;
    await stderr;
    await producer.close();
    await rm(cwd, { recursive: true, force: true });
  }
}, 20000);

test.each(["process", "thread"])(
  "worker --check initializes and disposes %s handlers before consumption",
  async (mode) => {
    const cwd = await createTestDirectory("jobs-preflight");
    const cli = new URL("../src/cli/main.ts", import.meta.url).pathname;
    const name = crypto.randomUUID();
    const queue = defineQueue(name, {
      jobs: { echo: defineJob({ input: z.string(), handler: (job) => job.data }) },
    });
    const producer = createJobs({
      queues: { work: queue },
      name,
      connection: redis.connection,
    });
    try {
      await mkdir(join(cwd, "src/server"), { recursive: true });
      await writeFile(
        join(cwd, "src/server/example-queue.ts"),
        `
      import {defineQueue,defineJob,z} from '@prinpo/stack/jobs';
      export default defineQueue('${name}',{module:import.meta.url,worker:{sandbox:'${mode}'},jobs:{echo:defineJob({
        input:z.string(),load:async resources=>{
          resources.defer(()=>Bun.write("disposed","yes").then(()=>{}));
          if(process.env.FAIL_INIT)throw new Error("missing worker dependency");
          return job=>job.data;
        }
      })}});
    `,
      );
      await writeFile(
        join(cwd, "src/server/host.ts"),
        `import {createJobs} from '@prinpo/stack/jobs';import work from './example-queue';export const jobs={queues:{work},connection:${JSON.stringify(redis.connection)}};`,
      );
      await writeFile(
        join(cwd, "src/server/worker.ts"),
        "import {startJobsWorker} from '@prinpo/stack/jobs';await startJobsWorker(()=>import('./host'));",
      );
      await producer.start();
      const job = await producer.client.work.add.echo("queued");
      const build = spawnSync("bun", [cli, "build"], { cwd, encoding: "utf8" });
      expect(build.status, build.stderr).toBe(0);
      await rm(join(cwd, "src"), { recursive: true });
      for (const failure of [true, false]) {
        const checked = spawnSync("bun", [cli, "worker", "--check"], {
          cwd,
          encoding: "utf8",
          timeout: 5000,
          env: { ...process.env, FAIL_INIT: failure ? "1" : "" },
        });
        expect(checked.status, checked.stderr).toBe(failure ? 1 : 0);
        if (failure) expect(checked.stderr).toContain("missing worker dependency");
        expect(await Bun.file(join(cwd, "disposed")).text()).toBe("yes");
        await rm(join(cwd, "disposed"));
        expect(await job.getState()).toBe("waiting");
      }
    } finally {
      await producer.close();
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
