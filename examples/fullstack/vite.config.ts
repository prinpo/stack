import { varlockVitePlugin } from "@prinpo/stack/env/vite";
import { stack } from "@prinpo/stack/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  cacheDir: "../../node_modules/.vite/fullstack",
  plugins: [varlockVitePlugin(), stack({ api: { target: "http://localhost:3000" } })],
  server: { port: 5173, strictPort: true },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts", "src/env/**"],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: { ignorePatterns: ["src/routeTree.gen.ts", "src/env/**"] },
});
