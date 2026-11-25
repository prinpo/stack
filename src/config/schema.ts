import { z } from "zod";

const composePolicy = z.enum(["managed", "start-only", "external"]);
const databasePolicy = z.enum(["managed", "external"]);
const scriptName = z.string().regex(/\S/, "Expected a package.json script name");
const commandScripts = z.strictObject({ pre: scriptName.optional(), post: scriptName.optional() });
const startupScripts = commandScripts.pick({ pre: true });

export const stackConfigSchema = z.strictObject({
  compose: z
    .strictObject({ dev: composePolicy.optional(), preview: composePolicy.optional() })
    .optional(),
  database: databasePolicy.optional(),
  scripts: z
    .strictObject({
      dev: commandScripts.optional(),
      preview: commandScripts.optional(),
      build: commandScripts.optional(),
      start: startupScripts.optional(),
      worker: startupScripts.optional(),
    })
    .optional(),
});

export type StackConfig = z.infer<typeof stackConfigSchema>;
export type ComposePolicy = z.infer<typeof composePolicy>;
export type DatabasePolicy = z.infer<typeof databasePolicy>;

export function parseStackConfig(value: unknown, source: string): StackConfig {
  const result = stackConfigSchema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues.map(({ path, message }) =>
    path.length ? `${path.join(".")}: ${message}` : message,
  );
  throw new Error(`Invalid Stack configuration in ${source}:\n${details.join("\n")}`);
}
