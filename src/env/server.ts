import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type SerializedEnvGraph, internal } from "varlock";

import { injectedEnvironment, matchesEnvironment, originalEnvironment } from "./environment";
import { serverEnvPaths } from "./paths";

export interface ServerEnvOptions {
  /** Server schema directory; defaults to env/server. */
  server?: string;
  /** Client schema directory; false supports a backend-only application. */
  client?: string | false;
}

type Graph = Awaited<ReturnType<typeof internal.loadEnvGraph>>;
const connectionKeys = ["HOST", "PORT", "NODE_ENV", "APP_ENV"];

async function graphAt(paths: string[], values: NodeJS.ProcessEnv, profile?: string) {
  const selected = profile ?? values.APP_ENV ?? values.NODE_ENV ?? "development";
  const entry = paths[paths.length - 1];
  const graph = await internal.loadEnvGraph({
    basePath: statSync(entry).isDirectory() ? entry : dirname(entry),
    entryFilePaths: paths,
    overrideValues: profile ? { ...values, APP_ENV: profile } : values,
    processEnvOverride: values,
    currentEnvFallback: selected,
  });
  internal.checkForSchemaErrors(graph);
  return graph;
}

function connection(graph: SerializedEnvGraph) {
  const { HOST, PORT, NODE_ENV, APP_ENV } = graph.config;
  return {
    host: String(HOST.value),
    port: Number(PORT.value),
    mode: String(NODE_ENV.value),
    profile: String(APP_ENV.value),
  };
}

/** Resolve only connection settings, never unrelated backend credentials. */
export async function readServerConnection(
  options: { server?: string; root?: string; profile?: string } = {},
) {
  const graph = await graphAt(serverEnvPaths(options), originalEnvironment(), options.profile);
  await graph.resolveEnvValues(connectionKeys);
  internal.checkForConfigErrors(graph);
  return connection(graph.getSerializedGraph());
}

async function classifyGraph(graph: Graph, publicOnly: boolean) {
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
        throw new Error(`Value-dependent metadata on ${item.key}: classification must be literal`);
    }
    // Pinned Varlock internals: classify without resolving @required or other
    // decorators that may depend on deployment credentials. Never replace methods
    // or mark metadata resolved: normal runtime resolution must still run in full.
    const classifier = item as unknown as {
      processSensitive(): Promise<void>;
      processDynamic(): Promise<void>;
    };
    await classifier.processSensitive();
    if (item.valueResolver?.def?.impliesSensitive && !item._sensitiveExplicitlySet)
      item._isSensitive = true;
    await classifier.processDynamic();
    if (!publicOnly || item.isBuiltin) continue;
    if (item.isSensitive || !item._sensitiveExplicitlySet)
      throw new Error(
        item.isSensitive
          ? `Client configuration contains sensitive item ${item.key}; ${item.key} must explicitly declare @public`
          : `Client item ${item.key} must explicitly declare @public (or @sensitive=false)`,
      );
  }
  internal.checkForSchemaErrors(graph);
}

async function clientSnapshot(
  clientPath: string | undefined,
  values: NodeJS.ProcessEnv,
  profile?: string,
) {
  let clientValues: Record<string, unknown> = {};
  let clientKeys: string[] = [];
  if (clientPath && existsSync(clientPath)) {
    const client = await graphAt([clientPath], values, profile);
    await classifyGraph(client, true);
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
export function readClientEnv(options: { client?: string; root?: string; profile?: string } = {}) {
  const path = resolve(options.root ?? process.cwd(), options.client ?? "env/client");
  if (options.client !== undefined && !existsSync(path))
    throw new Error(`Client environment path does not exist: ${path}`);
  return clientSnapshot(path, originalEnvironment(), options.profile);
}

/** Initialize server ENV once; production also captures client values for HTML. */
async function initializeServerEnv(options: ServerEnvOptions) {
  const injected = injectedEnvironment();
  const values = originalEnvironment(injected);
  const runtimeValues = injected
    ? {
        ...values,
        NODE_ENV: values.NODE_ENV ?? String(injected.config.NODE_ENV?.value ?? "development"),
      }
    : values;
  const profile =
    runtimeValues.APP_ENV ?? injected?.config.APP_ENV?.value ?? runtimeValues.NODE_ENV;
  const graph = await graphAt(serverEnvPaths(options), runtimeValues, profile);
  // Native varlock run already resolved providers. Reuse its application values;
  // resolve Stack's connection settings separately with their owned validation.
  await graph.resolveEnvValues(connectionKeys);
  internal.checkForConfigErrors(graph);
  const selected = connection(graph.getSerializedGraph());
  const reuse = injected && matchesEnvironment(injected, selected.mode, selected.profile);
  if (!reuse) await graph.resolveEnvValues();
  internal.checkForConfigErrors(graph);
  const server = graph.getSerializedGraph();
  if (reuse)
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
  const client = await clientSnapshot(clientPath, values, settings.profile);
  process.env.__VARLOCK_ENV = JSON.stringify(server);
  // Reuse this validated graph instead of loading the package's client schema.
  const previousReuse = process.env._VARLOCK_USE_INJECTED_ENV;
  process.env._VARLOCK_USE_INJECTED_ENV = "1";
  try {
    await import("varlock/auto-load");
  } finally {
    if (previousReuse === undefined) delete process.env._VARLOCK_USE_INJECTED_ENV;
    else process.env._VARLOCK_USE_INJECTED_ENV = previousReuse;
  }
  return { ...settings, ...client };
}

let startup: ReturnType<typeof initializeServerEnv> | undefined;

/** One validated configuration snapshot per server process, shared by startup callers. */
export function loadServerEnv(options: ServerEnvOptions = {}) {
  startup ??= initializeServerEnv(options);
  return startup;
}

/** Locate local logs without resolving or validating unrelated credentials. */
export async function readLogDirectory(profile?: string) {
  const values = originalEnvironment();
  const graph = await graphAt(serverEnvPaths(), values, profile);
  if (!graph.configSchema.LOG_DIR) return values.LOG_DIR ?? ".evlog/logs";
  await graph.resolveEnvValues(["LOG_DIR"]);
  internal.checkForConfigErrors(graph);
  const value = graph.getSerializedGraph().config.LOG_DIR.value;
  if (typeof value !== "string" || !value)
    throw new Error("LOG_DIR must be a nonempty directory path");
  return value;
}

/** Check client exposure metadata without resolving values (including during codegen). */
export async function validateClientEnv(paths: string[], profile?: string) {
  await classifyGraph(await graphAt(paths, originalEnvironment(), profile), true);
}

/** Validate static inputs without resolving runtime credentials or trusting snapshots. */
export async function loadStaticEnv(
  paths: string[],
  options: { profile?: string; publicOnly?: boolean; values?: NodeJS.ProcessEnv } = {},
) {
  const graph = await graphAt(paths, options.values ?? originalEnvironment(), options.profile);
  await classifyGraph(graph, options.publicOnly ?? false);
  const keys = Object.values(graph.configSchema)
    .filter((item) => !item.isDynamic)
    .map((item) => item.key);
  for (const key of keys) {
    for (const dep of graph.expandKeysWithTransitiveDeps([key])) {
      if (graph.configSchema[dep]?.isDynamic)
        throw new Error(`Static item ${key} depends on dynamic item ${dep}; mark ${key} @dynamic`);
    }
  }
  await graph.resolveEnvValues(keys);
  internal.checkForConfigErrors(graph);
  await graph.runCodeGeneratorsIfNeeded();
  return graph.getSerializedGraph();
}
