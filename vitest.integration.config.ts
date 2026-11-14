import { defineConfig } from "vitest/config";

/** Real-database tests (PLAN §9 from Phase B); run through `pnpm test:integration`. */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.integration.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
