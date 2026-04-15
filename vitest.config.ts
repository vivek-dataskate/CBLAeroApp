import path from "node:path";
import { config } from "dotenv";

import { defineConfig } from "vitest/config";

// Load .env.local for tests
config({ path: ".env.local" });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15000, // Increase timeout to allow for slower network operations
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/e2e/**'], // Exclude e2e tests
    env: {
      NODE_ENV: "test",
      CBL_FORCE_SUPABASE_FOR_TESTS: "false", // Use in-memory persistence despite having Supabase config
    },
  },
});
