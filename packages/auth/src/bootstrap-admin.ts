import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@bsd/database";
import { bootstrapSuperAdmin } from "./bootstrap";

/**
 * `pnpm --filter @bsd/auth bootstrap-admin` — reads BOOTSTRAP_* from the environment (or the
 * repo `.env`), creates the tenant and the first super-admin once, and never prints secrets.
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const db = createDatabase(process.env.DIRECT_URL ?? required("DATABASE_URL"));
try {
  const result = await bootstrapSuperAdmin(db, {
    tenantName: process.env.BOOTSTRAP_TENANT_NAME ?? "Bhuiyan Store",
    adminEmail: required("BOOTSTRAP_ADMIN_EMAIL"),
    adminName: process.env.BOOTSTRAP_ADMIN_NAME ?? "Super Admin",
    adminPassword: required("BOOTSTRAP_ADMIN_PASSWORD"),
  });
  process.stdout.write(
    result.created
      ? "Super-admin created. Sign in with the bootstrap password.\n"
      : "Super-admin already exists; account unchanged. Default staff roles are in place.\n",
  );
} finally {
  await db.$disconnect();
}
