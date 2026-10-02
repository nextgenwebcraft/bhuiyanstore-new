// Applies migrations to the test schema, then runs the real-database tests.
// TEST_DATABASE_URL must name a non-public schema (`...&schema=test`); it is never printed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("TEST_DATABASE_URL is not set; skipping integration tests.");
  process.exit(0);
}
const schema = new URL(url).searchParams.get("schema");
if (!schema || schema === "public") {
  console.error("TEST_DATABASE_URL must select a dedicated schema, e.g. &schema=test");
  process.exit(1);
}

const run = (args, cwd, env = {}) => {
  const result = spawnSync(`pnpm ${args.join(" ")}`, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const root = new URL("..", import.meta.url);
run(["exec", "prisma", "migrate", "deploy"], new URL("packages/database/", root), {
  PRISMA_MIGRATE_URL: url,
});
run(["exec", "vitest", "run", "--config", "vitest.integration.config.ts"], root);
