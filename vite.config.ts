import { defineConfig } from "vite-plus";

const integrationTests =
  "tests/{cli,cli-compose,database,env-runtime,env-vite,jobs,jobs-lifecycle,jobs-regressions,jobs-workers}.test.ts";
const smokeTests = "tests/package-release.test.ts";

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
          exclude: ["tests/eden-query/**", "tests/i18n-*.test.tsx", integrationTests, smokeTests],
        },
      },
      { test: { name: "integration", include: [integrationTests] } },
      { test: { name: "smoke", include: [smokeTests] } },
      {
        resolve: { conditions: ["browser", "module", "development|production"] },
        test: {
          name: "i18n-browser",
          include: ["tests/i18n-*.test.tsx"],
          server: { deps: { inline: ["gt-react"] } },
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
    ignorePatterns: [
      ".agents/**",
      "**/auth.generated.ts",
      "**/routeTree.gen.ts",
      "examples/fullstack/src/env-gen/**",
      "src/database/generated/**",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "sort-imports": ["warn", { ignoreDeclarationSort: true }],
    },
  },
  fmt: {
    ignorePatterns: [
      ".agents/**",
      "**/auth.generated.ts",
      "**/routeTree.gen.ts",
      "examples/fullstack/src/env-gen/**",
      "src/database/generated/**",
    ],
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
