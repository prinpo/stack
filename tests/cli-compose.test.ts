import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

import { createTestDirectory } from "./test-utils/directory";

const cli = resolve("src/cli/main.ts");
const bun = spawnSync("bun", ["--no-env-file", "-p", "process.execPath"], {
  encoding: "utf8",
}).stdout.trim();
const directories: string[] = [];
const children: ReturnType<typeof spawn>[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "close");
    }
  }
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

async function fixture() {
  const cwd = await createTestDirectory("compose");
  directories.push(cwd);
  await mkdir(join(cwd, "bin"));
  await mkdir(join(cwd, "src/server"), { recursive: true });
  await writeFile(join(cwd, "active-context"), "original-context");
  await writeFile(
    join(cwd, "docker-compose.dev.yml"),
    "services: { postgres: { image: postgres:18 } }\n",
  );
  await writeFile(
    join(cwd, "src/server/index.ts"),
    `
    import { appendFileSync } from "node:fs";
    appendFileSync("events", "app-start\\n");
    process.on("SIGTERM", () => { appendFileSync("events", "app-stop\\n"); process.exit(0); });
    setInterval(() => {}, 1000);
  `,
  );
  await writeFile(
    join(cwd, "bin/docker"),
    `#!/usr/bin/env -S bun --no-env-file
    import { appendFileSync, existsSync, readFileSync } from "node:fs";
    const args = process.argv.slice(2);
    const operation = args.includes("up") ? "up" : args.includes("stop") ? "stop" : args.includes("config") ? "config" : args.includes("info") ? "info" : args.includes("compose") ? "compose" : args.includes("context") ? "context" : "docker";
    appendFileSync("events", operation + "\\n");
    appendFileSync("docker-commands", JSON.stringify({args, inherited: process.env.COMPOSE_FIXTURE_VALUE, appEnv: process.env.APP_ENV}) + "\\n");
    if ((operation === "up" || operation === "stop") && !args.includes("--project-name")) { console.error("Compose project identity must remain stable"); process.exit(93); }
    if (operation === "stop" && args.includes("-f") && !existsSync(args[args.indexOf("-f") + 1])) { console.error("compose file unavailable"); process.exit(29); }
    if (process.env.FIXTURE_FAIL?.split(",").includes(operation)) { console.error("native compose failure: " + operation); process.exit(operation === "stop" ? 23 : 17); }
    if (operation === "stop" && process.env.FIXTURE_HANG_STOP) {
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 1000);
    }
    if (operation === "config") console.log(JSON.stringify({name: process.env.FIXTURE_PROJECT ?? ${JSON.stringify(cwd)}}));
    if (operation === "context") console.log(readFileSync("active-context", "utf8"));
    if (operation === "stop" && process.env.FIXTURE_CONTEXT_SWITCH) {
      const context = args.includes("--context") ? args[args.indexOf("--context") + 1] : readFileSync("active-context", "utf8");
      if (context !== "original-context") { console.error("Attempted to stop a different Docker daemon"); process.exit(31); }
    }
    if (operation === "info") console.log(process.env.FIXTURE_DAEMON ?? "fixture-daemon");
    if (operation === "up") {
      await Bun.write("docker-up-pid", String(process.pid));
      if (!args.includes("--wait") || args[args.indexOf("--wait-timeout") + 1] !== "120") { console.error("Readiness wait required"); process.exit(91); }
      while (!existsSync("ready")) await Bun.sleep(10);
    }
  `,
  );
  await chmod(join(cwd, "bin/docker"), 0o755);
  return cwd;
}

function launch(
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  args: string[] = [],
  command: "dev" | "preview" = "dev",
) {
  const child = spawn(bun, ["--no-env-file", cli, command, ...args], {
    cwd,
    env: {
      ...process.env,
      NO_COLOR: "1",
      DOCKER_HOST: "",
      DOCKER_CONTEXT: "",
      PATH: `${join(cwd, "bin")}:${process.env.PATH}`,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  return {
    child,
    output: () => output,
    exited: new Promise<number | null>((done) => child.once("close", done)),
  };
}

async function events(cwd: string) {
  try {
    return await readFile(join(cwd, "events"), "utf8");
  } catch {
    return "";
  }
}

test("development waits for the whole Compose project and stops app processes before its services", async () => {
  const cwd = await fixture();
  const app = launch(cwd);
  await expect.poll(() => events(cwd)).toContain("up\n");
  expect(await events(cwd)).not.toContain("app-start");
  await writeFile(join(cwd, "ready"), "");
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  app.child.kill("SIGTERM");
  expect(await app.exited, app.output()).toBe(143);
  expect(await events(cwd)).toContain("app-stop\nstop\n");
});

test.each([false, true])(
  "development runs session scripts around app execution (pre fails=%s)",
  async (preFails) => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, "stack.config.ts"),
      'export default { scripts: { dev: { pre: "prepare:dev", post: "postprepare:dev" } } };',
    );
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          "prepare:dev": `printf 'pre\\n' >> events; exit ${preFails ? 17 : 0}`,
          "postprepare:dev": "printf 'post\\n' >> events; exit 23",
        },
      }),
    );
    const app = launch(cwd);
    await expect.poll(() => events(cwd)).toContain("up\n");
    expect(await events(cwd)).not.toContain("pre\n");
    await writeFile(join(cwd, "ready"), "");
    if (!preFails) {
      await expect.poll(() => events(cwd)).toContain("pre\napp-start\n");
      app.child.kill("SIGINT");
    }
    expect(await app.exited, app.output()).toBe(preFails ? 17 : 130);
    expect(await events(cwd)).toContain(
      preFails ? "up\npre\npost\nstop\n" : "app-stop\npost\nstop\n",
    );
    if (preFails) expect(await events(cwd)).not.toContain("app-start");
  },
);

test("external development Compose policy makes no Docker calls", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "stack.config.ts"), 'export default { compose: { dev: "external" } };');
  const app = launch(cwd);
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  app.child.kill("SIGTERM");
  expect(await app.exited, app.output()).toBe(143);
  expect(await events(cwd)).toBe("app-start\napp-stop\n");
});

test("interrupting the pre script still runs post before Compose teardown", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "ready"), "");
  await writeFile(
    join(cwd, "stack.config.ts"),
    'export default { scripts: { dev: { pre: "prepare:dev", post: "cleanup:dev" } } };',
  );
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        "prepare:dev": "printf 'pre\\n' >> events; sleep 60",
        "cleanup:dev": "printf 'post\\n' >> events",
      },
    }),
  );
  const app = launch(cwd);
  await expect.poll(() => events(cwd)).toContain("pre\n");
  app.child.kill("SIGINT");
  expect(await app.exited, app.output()).toBe(130);
  expect(await events(cwd)).toContain("pre\npost\nstop\n");
  expect(await events(cwd)).not.toContain("app-start");
});

test.each([false, true])("start-only never stops Compose when startup fails=%s", async (fails) => {
  const cwd = await fixture();
  await writeFile(
    join(cwd, "stack.config.ts"),
    'export default { compose: { dev: "start-only" } };',
  );
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd, { FIXTURE_FAIL: fails ? "up" : undefined });
  if (!fails) {
    await expect.poll(() => events(cwd)).toContain("up\napp-start\n");
    app.child.kill("SIGTERM");
  }
  expect(await app.exited, app.output()).toBe(fails ? 17 : 143);
  expect(await events(cwd)).toContain("up\n");
  expect((await events(cwd)).split("\n")).not.toContain("stop");
});

test.each(["docker", "compose", "context", "info", "config"])(
  "a failed %s prerequisite prevents app startup and does not stop existing services",
  async (operation) => {
    const cwd = await fixture();
    const app = launch(cwd, { FIXTURE_FAIL: operation });
    expect(await app.exited).toBe(17);
    expect(app.output()).toContain(`native compose failure: ${operation}`);
    expect(await events(cwd)).not.toMatch(/(?:up|stop|app-start)\n/);
  },
);

test("missing Docker reports the prerequisite without starting application processes", async () => {
  const cwd = await fixture();
  const app = launch(cwd, { PATH: join(cwd, "empty") });
  expect(await app.exited).toBe(1);
  expect(app.output()).toContain("Docker CLI is unavailable");
  expect(await events(cwd)).toBe("");
});

test.each(["docker-compose.yml", "compose.dev.yml"])(
  "%s does not enable Docker operations",
  async (filename) => {
    const cwd = await fixture();
    await rm(join(cwd, "docker-compose.dev.yml"));
    await writeFile(join(cwd, filename), "services: {}\n");
    const app = launch(cwd, { PATH: join(cwd, "empty") });
    await expect.poll(() => events(cwd)).toContain("app-start\n");
    app.child.kill("SIGTERM");
    expect(await app.exited, app.output()).toBe(143);
    expect(await events(cwd)).toBe("app-start\napp-stop\n");
  },
);

test("Compose inherits the caller's environment without Stack profile or environment-file injection", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, ".env.development"), "COMPOSE_FIXTURE_VALUE=development-file\n");
  await mkdir(join(cwd, "env/server"), { recursive: true });
  await writeFile(join(cwd, "env/server/.env.schema"), "COMPOSE_FIXTURE_VALUE=exec(`exit 97`)\n");
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd, { APP_ENV: "caller-profile", COMPOSE_FIXTURE_VALUE: "caller-value" }, [
    "--env",
    "staging",
  ]);
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  app.child.kill("SIGTERM");
  expect(await app.exited).toBe(143);
  for (const line of (await readFile(join(cwd, "docker-commands"), "utf8")).trim().split("\n")) {
    const command = JSON.parse(line);
    expect(command).toMatchObject({ inherited: "caller-value", appEnv: "caller-profile" });
    expect(command.args).not.toContain("--env-file");
    expect(command.args).not.toContain("--profile");
  }
});

test("a failed Compose launch prints the native error and stops the whole project", async () => {
  const cwd = await fixture();
  const app = launch(cwd, { FIXTURE_FAIL: "up" });
  expect(await app.exited).toBe(17);
  expect(app.output()).toContain("native compose failure: up");
  expect(await events(cwd)).toContain("up\nstop\n");
  expect(await events(cwd)).not.toContain("app-start");
});

test.each(["SIGINT", "SIGTERM"] as const)(
  "%s during dependency startup stops the whole project without launching the app",
  async (signal) => {
    const cwd = await fixture();
    await mkdir(join(cwd, "env/server"), { recursive: true });
    const app = launch(cwd);
    await expect.poll(() => events(cwd)).toContain("up\n");
    await writeFile(join(cwd, "env/server/.env"), "CHANGED=1\n");
    app.child.kill(signal);
    expect(await app.exited, app.output()).toBe(signal === "SIGINT" ? 130 : 143);
    expect(await events(cwd)).toContain("up\nstop\n");
    expect(await events(cwd)).not.toContain("app-start");
  },
);

test("cleanup failures are reported without replacing the original startup failure", async () => {
  const cwd = await fixture();
  const app = launch(cwd, { FIXTURE_FAIL: "up,stop" });
  expect(await app.exited).toBe(17);
  expect(app.output()).toContain("native compose failure: up");
  expect(app.output()).toContain("native compose failure: stop");
  expect(app.output()).toContain("Failed to stop development Compose services");
});

test("removing the Compose file during development still stops the original project", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd);
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  await rm(join(cwd, "docker-compose.dev.yml"));
  app.child.kill("SIGTERM");
  expect(await app.exited).toBe(143);
  expect(app.output()).not.toContain("Failed to stop");
});

test("application environment restarts preserve dependencies and do not reload Compose changes", async () => {
  const cwd = await fixture();
  await mkdir(join(cwd, "env/server"), { recursive: true });
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd);
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  await writeFile(join(cwd, "docker-compose.dev.yml"), "malformed compose\n");
  await writeFile(join(cwd, "env/server/.env"), "RESTART=1\n");
  await expect.poll(async () => (await events(cwd)).split("app-start\n").length).toBe(3);
  expect((await events(cwd)).split("\n").filter((event) => event === "up")).toHaveLength(1);
  expect(await events(cwd)).not.toContain("\nstop\n");
  app.child.kill("SIGTERM");
  expect(await app.exited, app.output()).toBe(143);
  expect((await events(cwd)).split("\n").filter((event) => event === "stop")).toHaveLength(1);
});

test("an unexpected application exit stops Compose and retains its failure if cleanup also fails", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "ready"), "");
  await writeFile(join(cwd, "src/server/index.ts"), "setTimeout(() => process.exit(9), 25);\n");
  const app = launch(cwd, { FIXTURE_FAIL: "stop" });
  expect(await app.exited).toBe(9);
  expect(await events(cwd)).toContain("up\nstop\n");
  expect(app.output()).toContain("native compose failure: stop");
});

test("cleanup timeouts are failures even if the Docker command handles termination successfully", async () => {
  const cwd = await fixture();
  const app = launch(cwd, { FIXTURE_FAIL: "up", FIXTURE_HANG_STOP: "1" });
  expect(await app.exited).toBe(17);
  expect(app.output()).toContain("Docker command timed out");
  expect(app.output()).toContain("Failed to stop development Compose services");
}, 40_000);

test("overlapping sessions cannot stop each other's Compose project, and a killed session releases ownership", async () => {
  const cwd = await fixture();
  const other = await fixture();
  const env = { FIXTURE_PROJECT: cwd };
  const first = launch(cwd, env);
  await expect.poll(() => events(cwd)).toContain("up\n");
  const second = launch(other, env);
  await expect.poll(() => second.output()).toContain("Another Stack development session");
  expect(await second.exited).toBe(1);
  expect(await events(other)).not.toMatch(/(?:up|stop)\n/);
  first.child.kill("SIGKILL");
  process.kill(Number(await readFile(join(cwd, "docker-up-pid"), "utf8")), "SIGTERM");
  await first.exited;
  await writeFile(join(other, "ready"), "");
  const recovered = launch(other, env);
  await expect.poll(() => events(other)).toContain("app-start\n");
  recovered.child.kill("SIGTERM");
  expect(await recovered.exited, recovered.output()).toBe(143);
  expect(await events(other)).toContain("stop\n");
});

test("different Docker daemons can run the same project name independently", async () => {
  const cwd = await fixture();
  const other = await fixture();
  await writeFile(join(cwd, "ready"), "");
  await writeFile(join(other, "ready"), "");
  const first = launch(cwd, { FIXTURE_PROJECT: cwd });
  const second = launch(other, { FIXTURE_PROJECT: cwd, FIXTURE_DAEMON: "other-daemon" });
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  await expect.poll(() => events(other)).toContain("app-start\n");
  first.child.kill("SIGTERM");
  expect(await first.exited).toBe(143);
  expect(await events(other)).not.toContain("\nstop\n");
  second.child.kill("SIGTERM");
  expect(await second.exited).toBe(143);
});

test("switching Docker's active context during development cannot redirect project cleanup", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd, { DOCKER_HOST: "", DOCKER_CONTEXT: "", FIXTURE_CONTEXT_SWITCH: "1" });
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  await writeFile(join(cwd, "active-context"), "other-context");
  app.child.kill("SIGTERM");
  expect(await app.exited).toBe(143);
  expect(app.output()).not.toContain("different Docker daemon");
  expect(app.output()).not.toContain("Failed to stop");
});

test.each([
  { DOCKER_HOST: "tcp://developer-docker:2375", DOCKER_CONTEXT: "" },
  { DOCKER_HOST: "", DOCKER_CONTEXT: "developer-context" },
])("explicit Docker settings remain developer-owned: %j", async (settings) => {
  const cwd = await fixture();
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd, settings);
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  app.child.kill("SIGTERM");
  expect(await app.exited).toBe(143);
  expect(await events(cwd)).not.toContain("context\n");
  for (const line of (await readFile(join(cwd, "docker-commands"), "utf8")).trim().split("\n")) {
    expect(JSON.parse(line).args).not.toContain("--context");
    expect(JSON.parse(line).args).not.toContain("--host");
  }
});

test.each([
  ["development", []],
  ["preview", ["--env", "preview"]],
] as const)(
  "built preview owns its Compose project and starts a separate worker after HTTP in the %s profile",
  async (profile, args) => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, "docker-compose.preview.yml"),
      "services: { redis: { image: redis } }",
    );
    await writeFile(
      join(cwd, "src/server/index.ts"),
      `
      import {appendFileSync, existsSync} from 'node:fs';
      appendFileSync('events','http-start\\n');
      while (!existsSync('migrated')) await Bun.sleep(10);
      await Bun.write('http-pid',String(process.pid));
      process.on('SIGTERM',()=>{appendFileSync('events','http-stop\\n');process.exit(0)});
      setInterval(()=>{},1000);
    `,
    );
    await writeFile(
      join(cwd, "src/server/worker.ts"),
      `
      import {appendFileSync} from 'node:fs';
      appendFileSync('events', 'worker-'+process.env.NODE_ENV+'-'+process.env.APP_ENV+'\\n');
      await Bun.write('worker-pid',String(process.pid));
      process.on('SIGTERM',()=>{appendFileSync('events','worker-stop\\n');process.exit(0)});
      setInterval(()=>{},1000);
    `,
    );
    const build = spawnSync(bun, ["--no-env-file", cli, "build"], { cwd, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    await rm(join(cwd, "src"), { recursive: true });
    const app = launch(cwd, { FIXTURE_PROJECT: cwd, APP_ENV: undefined }, [...args], "preview");
    await expect.poll(() => events(cwd)).toContain("up\n");
    expect(await events(cwd)).not.toContain("http-start");
    await writeFile(join(cwd, "ready"), "");
    await expect.poll(() => events(cwd)).toContain("http-start");
    expect(await events(cwd)).not.toContain("worker-");
    await writeFile(join(cwd, "migrated"), "");
    await expect.poll(() => events(cwd)).toContain(`worker-production-${profile}`);
    expect(await readFile(join(cwd, "http-pid"), "utf8")).not.toBe(
      await readFile(join(cwd, "worker-pid"), "utf8"),
    );
    app.child.kill("SIGTERM");
    expect(await app.exited, app.output()).toBe(143);
    expect(await events(cwd)).toContain("http-stop\nworker-stop\nstop\n");
    const docker = await readFile(join(cwd, "docker-commands"), "utf8");
    expect(docker).toContain("docker-compose.preview.yml");
    expect(docker).not.toContain("docker-compose.dev.yml");
    expect(docker).toContain(`"--project-name","${cwd}-preview"`);
  },
);

test("preview validates its build before starting Compose", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "docker-compose.preview.yml"), "services: {}");
  const app = launch(cwd, {}, [], "preview");
  expect(await app.exited).toBe(1);
  expect(app.output()).toContain("Run stack build");
  expect(await events(cwd)).toBe("");
});

test("preview reads current Compose policy and scripts independently of the build", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "docker-compose.preview.yml"), "services: {}");
  await writeFile(
    join(cwd, "stack.config.ts"),
    'export default { scripts: { start: { pre: "prepare:start" } } };',
  );
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        "prepare:start": "printf 'start-pre\\n' >> events",
        "prepare:preview": "printf 'preview-pre\\n' >> events",
        "cleanup:preview": "printf 'preview-post\\n' >> events",
      },
    }),
  );
  const build = spawnSync(bun, ["--no-env-file", cli, "build"], { cwd, encoding: "utf8" });
  expect(build.status, build.stderr).toBe(0);
  await writeFile(
    join(cwd, "stack.config.ts"),
    `export default {
    compose: { preview: "external" },
    scripts: { preview: { pre: "prepare:preview", post: "cleanup:preview" } }
  };`,
  );
  const app = launch(cwd, {}, [], "preview");
  await expect.poll(() => events(cwd)).toContain("app-start\n");
  app.child.kill("SIGINT");
  expect(await app.exited, app.output()).toBe(130);
  expect(await events(cwd)).toBe("preview-pre\napp-start\napp-stop\npreview-post\n");
});

test("a failed HTTP preview skips the worker and stops Compose", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "docker-compose.preview.yml"), "services: {}");
  await writeFile(join(cwd, "src/server/index.ts"), "process.exit(19);");
  await writeFile(join(cwd, "src/server/worker.ts"), 'await Bun.write("worker-started","yes");');
  const build = spawnSync(bun, ["--no-env-file", cli, "build"], { cwd, encoding: "utf8" });
  expect(build.status, build.stderr).toBe(0);
  await writeFile(join(cwd, "ready"), "");
  const app = launch(cwd, {}, [], "preview");
  expect(await app.exited, app.output()).toBe(19);
  expect(await events(cwd)).toContain("up\nstop\n");
  await expect(readFile(join(cwd, "worker-started"))).rejects.toThrow();
});
