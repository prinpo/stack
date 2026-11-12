import { logState } from "./state";

if (!logState.built && process.send) {
  logState.emit = (values) => {
    if (process.connected) process.send?.({ type: "stack:browser-log", values }, () => {});
  };
}
