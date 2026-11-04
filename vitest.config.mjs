import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "scenarios/**/*.test.ts", "apps/web/lib/*.test.ts"],
    retry: 0,
    testTimeout: 20000,
  },
});
