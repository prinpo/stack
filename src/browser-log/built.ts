import { logState } from "./state";

// Imported before external application dependencies by the native Bun build banner.
logState.emit = undefined;
Object.defineProperty(logState, "built", { value: true, writable: false, configurable: false });
