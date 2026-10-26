import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix --no-error-on-unmatched-pattern",
  },
  pack: {
    entry: [
      "src/server.ts",
      "src/client.ts",
      "src/react.tsx",
      "src/query.ts",
      "src/devtools.ts",
      "src/vite.ts",
      "src/logger.ts",
      "src/logger/elysia.ts",
      "src/logger/client.ts",
    ],
    deps: { neverBundle: true, onlyBundle: [], resolveDepSubpath: false },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  test: {
    projects: [
      {
        test: {
          name: "stack",
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/eden-query/**"],
        },
      },
      {
        test: {
          name: "eden-query",
          include: ["tests/eden-query/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
          setupFiles: ["./tests/eden-query/test-utils/testing-library.ts"],
        },
      },
    ],
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
