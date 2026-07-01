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
    env: {
      // Placeholder DATABASE_URL so db.ts can initialize without a real Neon connection.
      // Tests that call the real Prisma query engine will still fail at the network layer,
      // but pure-function unit tests (injectUserId, forUser) never make DB calls and pass.
      DATABASE_URL:
        "postgresql://test:test@localhost:5432/test_placeholder",
    },
  },
});
