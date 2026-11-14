import { database, type Database } from "@bsd/database";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

export const MIN_PASSWORD_LENGTH = 6;

/** Access-token analogue: signed session cookie-cache lifetime (D124). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
/** Refresh-token analogue: durable DB session lifetime (D124). */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Email + password sign-in only. Public sign-up is disabled: users are created by an
 * administrator (and the first super-admin by the bootstrap script, guide §12.1).
 *
 * Better Auth uses a cookie session, not separate JWT access/refresh tokens. Mapping
 * (D124): `cookieCache.maxAge` ≈ access (7 days); `expiresIn` ≈ refresh (30 days).
 * API routes force a DB session read so revoke/deactivate still take effect immediately.
 */
export function createAuth(db: Database) {
  return betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      updateAge: ACCESS_TOKEN_TTL_SECONDS,
      cookieCache: {
        enabled: true,
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
      },
    },
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
