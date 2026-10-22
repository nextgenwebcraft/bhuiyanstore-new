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
  if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error("Invalid schema name in the connection string");
  }
  // pg already treats `require` as full certificate verification; say so explicitly.
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  // The adapter's `schema` qualifies model queries only; raw queries (row locks) need the search path.
  const adapter = new PrismaPg(
    schema
      ? { connectionString: url.toString(), options: `-c search_path=${schema}` }
      : { connectionString: url.toString() },
    schema ? { schema } : undefined,
  );
  // A day's posting or a month import writes many rows in one transaction over a remote link.
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 60_000 } });
}

const globalForDb = globalThis as unknown as {
  bsdDatabase?: Database | { $disconnect(): Promise<void> };
};

/**
 * The app's shared client (pooled `DATABASE_URL`), reused across dev hot reloads. A client built
 * from an older generated `PrismaClient` (before a migration added models) is replaced.
 */
export function database(): Database {
  const cached = globalForDb.bsdDatabase;
  if (cached && cached instanceof PrismaClient) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  void cached?.$disconnect().catch(() => undefined);
  const fresh = createDatabase(url);
  globalForDb.bsdDatabase = fresh;
  return fresh;
}
