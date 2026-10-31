import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { type SerializedEnvGraph, internal } from "varlock";

export interface ServerEnvOptions {
  /** Server schema directory; defaults to env/server. */
  server?: string;
  /** Client schema directory; false supports a backend-only application. */
  client?: string | false;
}

type Graph = Awaited<ReturnType<typeof internal.loadEnvGraph>>;
const defaults = createRequire(import.meta.url).resolve("@prinpo/stack/env/defaults");
const connectionKeys = ["HOST", "PORT", "NODE_ENV"];

function originalEnvironment(
  injected: SerializedEnvGraph | undefined = process.env.__VARLOCK_ENV
    ? JSON.parse(process.env.__VARLOCK_ENV)
    : undefined,
) {
  const values = { ...process.env };
  // A CLI startup snapshot must not turn backend-only values into overrides of
  // the independent client schema. Retain genuine process overrides.
  if (injected) {
    const overrides = new Set(injected.overrideKeys);
    for (const [key, item] of Object.entries(injected.config)) {
      if (!overrides.has(key) && values[key] === (item.envStr ?? String(item.value)))
        delete values[key];
    }
  }
  delete values.__VARLOCK_ENV;
  return values;
}

async function graphAt(paths: string[], values: NodeJS.ProcessEnv, mode?: string) {
  const entry = paths[paths.length - 1];
  const graph = await internal.loadEnvGraph({
    basePath: statSync(entry).isDirectory() ? entry : dirname(entry),
    entryFilePaths: paths,
    overrideValues: mode ? { ...values, NODE_ENV: mode } : values,
    processEnvOverride: values,
    currentEnvFallback: mode ?? values.NODE_ENV ?? "development",
  });
  internal.checkForSchemaErrors(graph);
  return graph;
}

function serverPaths(path: string, required = false) {
  if (required && !existsSync(path))
    throw new Error(`Server environment path does not exist: ${path}`);
  return existsSync(path) ? [defaults, path] : [defaults];
}

function connection(graph: SerializedEnvGraph) {
  const { HOST, PORT, NODE_ENV } = graph.config;
  return {
    host: String(HOST.value),
    port: Number(PORT.value),
    mode: String(NODE_ENV.value),
  };
}

/** Resolve only connection settings, never unrelated backend credentials. */
export async function readServerConnection(
  options: { server?: string; root?: string; mode?: string } = {},
) {
  const path = resolve(options.root ?? process.cwd(), options.server ?? "env/server");
  const graph = await graphAt(
    serverPaths(path, options.server !== undefined),
    originalEnvironment(),
    options.mode,
  );
  await graph.resolveEnvValues(connectionKeys);
  internal.checkForConfigErrors(graph);
  return connection(graph.getSerializedGraph());
}

async function requirePublicClient(graph: Graph) {
  for (const item of Object.values(graph.configSchema)) {
    const decorators = [
      ...Object.values(item.effectiveDecorators),
      ...Object.values(item.effectiveDecoratorFns).flat(),
    ];
    for (const dec of decorators) {
      if (
        ["public", "sensitive", "static", "dynamic"].includes(dec.name) &&
        dec.decValueResolver &&
        !dec.decValueResolver.isStatic
      )
        throw new Error(
          `Value-dependent metadata on ${item.key}: client classification must be literal`,
        );
    }
    // The pinned patch supports classification-only resolution; upstream's
    // declaration still describes its original zero-argument method.
    const classify: (classificationOnly?: boolean) => Promise<void> =
      item.resolveMetadata.bind(item);
    await classify(true);
    if (item.isBuiltin) continue;
    if (item.isSensitive || !item._sensitiveExplicitlySet)
      throw new Error(`Client configuration item ${item.key} must explicitly declare @public`);
  }
  internal.checkForSchemaErrors(graph);
}

async function clientSnapshot(
  clientPath: string | undefined,
  values: NodeJS.ProcessEnv,
  mode?: string,
) {
  let clientValues: Record<string, unknown> = {};
  let clientKeys: string[] = [];
  if (clientPath && existsSync(clientPath)) {
    const client = await graphAt([clientPath], values, mode);
    await requirePublicClient(client);
    clientKeys = Object.values(client.configSchema)
      .filter((item) => !item.isBuiltin && item.isDynamic)
      .map((item) => item.key);
    await client.resolveEnvValues(clientKeys);
    internal.checkForConfigErrors(client);
    const snapshot = client.getSerializedGraph();
    clientValues = Object.fromEntries(
      clientKeys
        .filter((key) => "value" in snapshot.config[key])
        .map((key) => [key, snapshot.config[key].value]),
    );
  }
  return { clientKeys, clientValues };
}

/** Resolve public client dynamics without initializing or replacing server ENV. */
export function readClientEnv(options: { client?: string; root?: string; mode?: string } = {}) {
  const path = resolve(options.root ?? process.cwd(), options.client ?? "env/client");
  if (options.client !== undefined && !existsSync(path))
    throw new Error(`Client environment path does not exist: ${path}`);
  return clientSnapshot(path, originalEnvironment(), options.mode);
}

/** Initialize server ENV once; production also captures client values for HTML. */
async function initializeServerEnv(options: ServerEnvOptions) {
  const injected: SerializedEnvGraph | undefined = process.env.__VARLOCK_ENV
    ? JSON.parse(process.env.__VARLOCK_ENV)
    : undefined;
  const values = originalEnvironment(injected);
  const path = resolve(options.server ?? "env/server");
  const mode = injected?.config.NODE_ENV?.value ?? values.NODE_ENV;
  const graph = await graphAt(serverPaths(path, options.server !== undefined), values, mode);
  // Native varlock run already resolved providers. Reuse its application values;
  // resolve Stack's connection settings separately with their owned validation.
  await graph.resolveEnvValues(injected ? connectionKeys : undefined);
  internal.checkForConfigErrors(graph);
  const server = graph.getSerializedGraph();
  if (injected)
    server.config = {
      ...injected.config,
      ...Object.fromEntries(connectionKeys.map((key) => [key, server.config[key]])),
    };
  const settings = connection(server);
  const clientPath =
    options.client === false || settings.mode !== "production"
      ? undefined
      : resolve(options.client ?? "env/client");
  if (clientPath && typeof options.client === "string" && !existsSync(clientPath))
    throw new Error(`Client environment path does not exist: ${clientPath}`);
  const client = await clientSnapshot(clientPath, values, settings.mode);
  process.env.__VARLOCK_ENV = JSON.stringify(server);
  // Reuse this validated graph instead of loading the package's client schema.
  const reuse = process.env._VARLOCK_USE_INJECTED_ENV;
  process.env._VARLOCK_USE_INJECTED_ENV = "1";
  try {
    await import("varlock/auto-load");
  } finally {
    if (reuse === undefined) delete process.env._VARLOCK_USE_INJECTED_ENV;
    else process.env._VARLOCK_USE_INJECTED_ENV = reuse;
  }
  return { ...settings, ...client };
}

let startup: ReturnType<typeof initializeServerEnv> | undefined;

/** One validated configuration snapshot per server process, shared by startup callers. */
export function loadServerEnv(options: ServerEnvOptions = {}) {
  startup ??= initializeServerEnv(options);
  return startup;
}
