#!/usr/bin/env node
/**
 * Pre-deploy regression suite for go-live / owner-facing money UI.
 * Run: `pnpm test:predeploy` (or ask the agent before each deploy).
 *
 * Covers: day-end cash parse + settlement, D133 damage card vs cash, D134 carton/free cost,
 * DSR date filter, dashboard card wiring, contracts damageTotal.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "packages/i18n/src/digits.test.ts",
  "packages/domain/src/field.test.ts",
  "packages/domain/src/batch-lots.test.ts",
  "packages/domain/src/month/staff-cost.test.ts",
  "packages/domain/src/month/order-carton-rate.test.ts",
  "packages/contracts/src/reporting.test.ts",
  "apps/web/src/features/dashboard/dashboard-cards.test.ts",
  "apps/web/src/features/daily/dsrs-on.test.ts",
  "apps/web/src/features/daily/daily-sheet-locks.test.ts",
  "apps/web/src/features/daily/dsr-summary-lines.test.ts",
  "packages/application/src/stock-guard.test.ts",
];

console.log("predeploy-check: vitest");
console.log(files.map((f) => `  - ${f}`).join("\n"));

const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", ...files], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  console.error("\npredeploy-check: FAILED");
  process.exit(result.status ?? 1);
}
console.log("\npredeploy-check: OK");
