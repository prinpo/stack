// Modified for Prinpo Stack. See src/eden-query/README.md.

import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vite-plus/test";

expect.extend(matchers);

// Cleans up `render` after each test
afterEach(() => {
  cleanup();
});
