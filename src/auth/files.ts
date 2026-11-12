import { isFile } from "../files";

export const authConfig = "src/auth.ts";
export const authSchema = "src/db/auth.generated.ts";
export function inspectAuth(config = authConfig, schema = authSchema) {
  const enabled = isFile(config);
  const ready = !enabled || isFile(schema);
  return {
    enabled,
    ready,
    config,
    schema,
    reason: !enabled
      ? `Missing ${config}; Auth Block is optional`
      : ready
        ? `Found ${config} and ${schema}`
        : `Missing ${schema}; run stack auth generate (custom paths require an explicit auth check)`,
  };
}
