/** Initialize the graph already validated by `varlock run --path ...`. */
if (!process.env.__VARLOCK_ENV) {
  throw new Error("Start the server with varlock run --path <server schema> -- bun <entry>");
}

// The package's default loadPath belongs to Vite and may differ from the CLI path.
// Explicit reuse prevents native auto-load from replacing the validated server graph.
const reuse = process.env._VARLOCK_USE_INJECTED_ENV;
process.env._VARLOCK_USE_INJECTED_ENV = "1";
try {
  await import("varlock/auto-load");
} finally {
  if (reuse === undefined) delete process.env._VARLOCK_USE_INJECTED_ENV;
  else process.env._VARLOCK_USE_INJECTED_ENV = reuse;
}
