import { stack } from "@prinpo/stack/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  cacheDir: "../../node_modules/.vite/fullstack",
  plugins: [stack({ api: true })],
  server: { port: 5173, strictPort: true },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts", "src/env-gen/**", "src/db/auth.generated.ts"],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: { ignorePatterns: ["src/routeTree.gen.ts", "src/env-gen/**", "src/db/auth.generated.ts"] },
});
