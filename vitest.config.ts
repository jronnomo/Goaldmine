import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal Vitest setup. The `@/` path alias mirrors tsconfig so source modules
// (which import each other via `@/lib/...`) resolve under the test runner too.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
