// Modified for Prinpo Stack. See src/eden-query/README.md.

import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import type { expect } from "vite-plus/test";

declare module "vite-plus/test" {
  // Required for matcher extension
  interface Assertion<T = any> extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers {}
}
