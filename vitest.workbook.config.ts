import { defineConfig } from "vitest/config";

/** Local-only real-workbook verification (PLAN §4); never part of `pnpm check`. */
export default defineConfig({
  test: {
    include: ["packages/importer/src/**/*.workbook.ts"],
    testTimeout: 600_000,
  },
});
