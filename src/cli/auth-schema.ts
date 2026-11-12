import type { BetterAuthOptions } from "better-auth";

import { generateSchema } from "auth/api";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isFile } from "../files";

/** Runs in an isolated Bun child with Stack's static environment snapshot, not c12/dotenv. */
async function run() {
  const [operation, configPath, outputPath, overwrite] = process.argv.slice(2);
  const config = resolve(configPath!);
  const output = resolve(outputPath!);
  if (!isFile(config)) throw new Error(`Missing auth config: ${config}`);
  const created = !isFile(output);
  if (created) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, "export {};\n", { flag: "wx" });
  }
  try {
    const module = await import(pathToFileURL(config).href);
    const options: BetterAuthOptions =
      module.authOptions ?? module.auth?.options ?? module.default?.options ?? module.default;
    if (!options || typeof options.database !== "function")
      throw new Error(
        "Export authOptions (native BetterAuthOptions) or auth with a Drizzle adapter. Keep schema-generation configuration free of live database connections.",
      );
    const adapter = options.database(options);
    if (adapter.id !== "drizzle" || !adapter.createSchema)
      throw new Error(
        "Use @prinpo/stack/auth/adapters/drizzle for native relations-v2 schema generation.",
      );
    const result = await generateSchema({ adapter, options, file: output });
    if (!result.code) throw new Error("The native adapter returned no generated schema.");
    // Follow Stack's owned-library import paths without modifying the native schema structure.
    const code = result.code
      .replaceAll('"drizzle-orm', '"@prinpo/stack/database')
      .replaceAll("'drizzle-orm", "'@prinpo/stack/database");
    if (operation === "info") {
      console.log(
        JSON.stringify({
          config: configPath,
          schema: outputPath,
          adapter: adapter.id,
          plugins: options.plugins?.map((plugin) => plugin.id) ?? [],
        }),
      );
    } else if (operation === "check") {
      if (created || (await readFile(output, "utf8")).trim() !== code.trim())
        throw new Error(
          "Auth schema is missing or out of date. Run stack auth generate --yes, then stack db generate.",
        );
      console.log(
        "Auth configuration and generated schema are current. This does not verify applied database migrations.",
      );
    } else {
      if (!created && overwrite !== "yes")
        throw new Error(
          "Auth schema exists. Review the changes and rerun with --yes to replace generated output.",
        );
      await writeFile(output, code);
      console.log(`Generated ${outputPath}. Run stack db generate to create SQL migrations.`);
      return;
    }
  } finally {
    if (created && isFile(output) && (await readFile(output, "utf8")) === "export {};\n")
      await unlink(output);
  }
}
try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
