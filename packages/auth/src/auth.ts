import { database, type Database } from "@bsd/database";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

export const MIN_PASSWORD_LENGTH = 6;

/**
 * Email + password sign-in only. Public sign-up is disabled: users are created by an
 * administrator (and the first super-admin by the bootstrap script, guide §12.1).
 */
export function createAuth(db: Database) {
  return betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    user: {
      additionalFields: {
        tenantId: { type: "string", required: false, input: false },
        isSuperAdmin: { type: "boolean", required: false, input: false, defaultValue: false },
        active: { type: "boolean", required: false, input: false, defaultValue: true },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A deactivated user cannot start a session.
          before: async (session) => {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { active: true },
            });
            return user?.active ? { data: session } : false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { bsdAuth?: Auth };

export function auth(): Auth {
  globalForAuth.bsdAuth ??= createAuth(database());
  return globalForAuth.bsdAuth;
}
