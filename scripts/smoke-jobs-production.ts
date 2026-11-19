import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../examples/fullstack", import.meta.url));
const project = `stack-jobs-smoke-${crypto.randomUUID().slice(0, 8)}`;
const env = {
  ...process.env,
  BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  STACK_HTTP_PORT: "0",
  STACK_MAIL_PORT: "0",
  STACK_IMAGE: "stack-jobs-smoke:local",
};
function compose(args: string[], stdout: "pipe" | "inherit" = "pipe") {
  const result = Bun.spawnSync(
    ["docker", "compose", "-p", project, "-f", "docker-compose.production.yml", ...args],
    { cwd, env, stdout, stderr: "inherit" },
  );
  assert.equal(result.exitCode, 0, `Compose failed: ${args.slice(0, 2).join(" ")}`);
  return result.stdout?.toString().trim() ?? "";
}

try {
  compose(["up", "--build", "--wait", "--wait-timeout", "90"], "inherit");
  assert.equal(compose(["ps", "--status", "running", "-q", "worker"]).split("\n").length, 2);
  const app = `http://${compose(["port", "app", "3000"])}`;
  const mail = `http://${compose(["port", "mailpit", "8025"])}`;
  const post = async (path: string, body: object) => {
    const result = await fetch(app + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.BETTER_AUTH_URL },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(result.ok, `${path} returned HTTP ${result.status}`);
    return result.json();
  };
  assert.deepEqual(await post("/api/jobs/format", { text: "compose" }), {
    text: "COMPOSE",
    length: 7,
  });
  const operationId = crypto.randomUUID();
  assert.deepEqual(await post("/api/jobs/messages", { operationId, text: "persisted" }), {
    id: `message-${operationId}`,
    operationId,
  });
  compose([
    "exec",
    "-T",
    "app",
    "bun",
    "--eval",
    `import { Database } from "bun:sqlite";
const db = new Database("/data/application.sqlite", { readonly: true });
const find = db.query("select text from job_results where operationId = ?");
const end = Date.now() + 5000;
while (Date.now() < end) {
  if (find.get(process.argv[1])?.text === "PERSISTED") process.exit(0);
  await Bun.sleep(100);
}
throw new Error("Worker did not persist the expected result");`,
    operationId,
  ]);
  await post("/api/auth/sign-in/magic-link", { email: "compose@example.test" });
  const inboxResponse = await fetch(mail + "/api/v1/messages", {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(inboxResponse.ok, "Mailpit inbox request failed");
  const inbox: { messages: { Subject: string }[] } = await inboxResponse.json();
  assert.ok(
    inbox.messages.some((message) => message.Subject === "Sign in"),
    "Missing auth email",
  );
  console.log("Compose smoke passed with two workers, an HTTP job result, SQLite, and auth mail.");
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"], "inherit");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
