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
    rules: {
      "sort-imports": ["warn", { ignoreDeclarationSort: true }],
    },
  },
  fmt: {
    ignorePatterns: [".agents/**", "**/routeTree.gen.ts"],
    sortImports: {
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        "type-internal",
        "value-internal",
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
    },
  },
});
