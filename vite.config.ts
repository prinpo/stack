import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix --no-error-on-unmatched-pattern",
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
    ignorePatterns: [".agents/**", "**/routeTree.gen.ts", "examples/fullstack/src/env/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "sort-imports": ["warn", { ignoreDeclarationSort: true }],
    },
  },
  fmt: {
    ignorePatterns: [".agents/**", "**/routeTree.gen.ts", "examples/fullstack/src/env/**"],
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
