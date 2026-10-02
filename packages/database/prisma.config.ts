import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

/**
 * Migrations always use a direct (non-pooled) connection. `PRISMA_MIGRATE_URL` lets the
 * integration-test script point migrations at the test schema without touching `.env`.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.PRISMA_MIGRATE_URL ?? process.env.DIRECT_URL ?? "",
  },
});
