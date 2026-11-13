import { inspect } from "node:util";

import { developmentLogging, logState } from "./browser-log/state";

/** Explicit development output to the server and every connected browser. Inert in built apps. */
export function browserLog(...values: unknown[]): void {
  if (!developmentLogging()) return;
  console.log(...values);
  if (!logState.emit) return;
  try {
    logState.emit(
      values
        .map((value) =>
          typeof value === "string"
            ? value.slice(0, 16_384)
            : inspect(value, {
                depth: 5,
                colors: false,
                getters: false,
                maxArrayLength: 100,
                maxStringLength: 16_384,
              }).slice(0, 16_384),
        )
        .slice(0, 20),
    );
  } catch {
    // Logging never changes the application's result.
  }
}
