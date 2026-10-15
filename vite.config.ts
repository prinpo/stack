import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix --no-error-on-unmatched-pattern",
  },
  pack: {
    entry: ["src/server.ts", "src/client.ts", "src/react.ts", "src/devtools.ts", "src/vite.ts"],
    deps: { neverBundle: true, onlyBundle: [], resolveDepSubpath: false },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    ignorePatterns: [".agents/**", "**/routeTree.gen.ts"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [".agents/**", "**/routeTree.gen.ts"],
  },
});
