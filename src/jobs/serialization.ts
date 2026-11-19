export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type Omitted = undefined | symbol | ((...args: never[]) => unknown);
type PropertySource<T> = T extends { toJSON(...args: never[]): infer Value } ? Value : T;
type StringKey<T> = Extract<keyof T, string | number>;
type PresentKeys<T> = {
  [K in StringKey<T>]: [PropertySource<T[K]>] extends [Omitted] ? never : K;
}[StringKey<T>];
type OptionalKeys<T> = {
  [K in PresentKeys<T>]: Extract<PropertySource<T[K]>, Omitted> extends never ? never : K;
}[PresentKeys<T>];
type JsonObject<T> = {
  -readonly [K in Exclude<PresentKeys<T>, OptionalKeys<T>>]: JsonNode<T[K]>;
} & { -readonly [K in OptionalKeys<T>]?: Exclude<JsonNode<T[K]>, undefined> };
type Simplify<T> = { [K in keyof T]: T[K] };
type JsonElement<T> =
  JsonNode<T> extends infer Value ? (Value extends undefined ? null : Value) : never;
type JsonNode<T> = 0 extends 1 & T
  ? JsonValue
  : unknown extends T
    ? JsonValue
    : T extends Date
      ? string | null
      : T extends { toJSON(...args: never[]): infer Value }
        ? JsonNode<Value>
        : T extends Omitted | void
          ? undefined
          : T extends bigint
            ? never
            : T extends string | boolean | null
              ? T
              : T extends number
                ? number extends T
                  ? number | null
                  : T
                : T extends readonly unknown[]
                  ? { -readonly [K in keyof T]: JsonElement<T[K]> }
                  : T extends object
                    ? Simplify<JsonObject<T>>
                    : never;

/** Successful JSON transport shape; invalid Dates and nonfinite numbers become null.
 * Property enumeration, cycles and custom toJSON behavior remain runtime concerns.
 */
export type JsonResult<T> = T extends void ? null : Exclude<JsonNode<T>, undefined>;

/** Normalize void consistently across inline, process and thread processors. */
export function serializeResult(value: unknown): unknown {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    // JSON.stringify calls toJSON first. Values left over must be plain data.
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError("Job result objects must be plain or provide a JSON representation");
    }
    return item;
  });
  if (json === undefined) {
    if (value === undefined) return null;
    throw new TypeError("Job result must be JSON-serializable");
  }
  return JSON.parse(json);
}
