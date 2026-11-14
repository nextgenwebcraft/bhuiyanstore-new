import { defineConfig } from "vitest/config";

/** SQL baseline for the Redis decision (T19); run through `pnpm benchmark:sql`. */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.benchmark.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    fileParallelism: false,
  },
});
