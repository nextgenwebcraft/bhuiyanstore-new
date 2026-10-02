import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type Database = PrismaClient;

/**
 * Creates a client for one connection string. A `schema` query parameter (used for the
 * integration-test schema) selects the Postgres schema; it is removed before connecting.
 */
export function createDatabase(connectionString: string): Database {
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") ?? undefined;
  url.searchParams.delete("schema");
  // pg already treats `require` as full certificate verification; say so explicitly.
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  const adapter = new PrismaPg(
    { connectionString: url.toString() },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { bsdDatabase?: Database };

/** The app's shared client (pooled `DATABASE_URL`), reused across dev hot reloads. */
export function database(): Database {
  if (!globalForDb.bsdDatabase) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.bsdDatabase = createDatabase(url);
  }
  return globalForDb.bsdDatabase;
}
