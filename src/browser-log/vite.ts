import type { Plugin } from "vite";

/** Default tooling only: never imported by an application runtime or emitted by build. */
export function browserLogPlugin(): Plugin {
  return {
    name: "prinpo:browser-log",
    apply: "serve",
    configureServer(server) {
      const listener = (message: unknown) => {
        if (
          !message ||
          typeof message !== "object" ||
          !("type" in message) ||
          message.type !== "stack:browser-log" ||
          !("values" in message) ||
          !Array.isArray(message.values)
        )
          return;
        server.ws.send("stack:browser-log", message.values);
      };
      process.on("message", listener);
      server.httpServer?.once("close", () => process.off("message", listener));
    },
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children:
            'import { createHotContext } from "/@vite/client"; createHotContext("/__stack_browser_log").on("stack:browser-log", values => console.log("[server]", ...values));',
          injectTo: "head",
        },
      ];
    },
  };
}
