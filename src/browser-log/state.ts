const key = Symbol.for("prinpo.stack.browser-log");
interface LogState {
  built: boolean;
  emit?: (values: string[]) => void;
}
const scope = globalThis as typeof globalThis & { [key]?: LogState };
export const logState = (scope[key] ??= { built: false });
export function developmentLogging() {
  return !logState.built && process.env.NODE_ENV === "development";
}
