import type { Database } from "@bsd/database";
import type { Auth } from "./auth";

/** The authenticated person behind a request. Never taken from the request body. */
export type Actor = {
  userId: string;
  tenantId: string;
  isSuperAdmin: boolean;
};

/** Resolves the actor from the session cookie; null when signed out, inactive or tenant-less. */
export async function actorFromHeaders(
  auth: Auth,
  db: Database,
  headers: Headers,
): Promise<Actor | null> {
  // Always re-read the DB session so cookieCache cannot outlive a revoke/reset (D124).
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      tenantId: true,
      isSuperAdmin: true,
      active: true,
    },
  });
  if (!user?.active || !user.tenantId) return null;
  return {
    userId: user.id,
    tenantId: user.tenantId,
    isSuperAdmin: user.isSuperAdmin,
  };
}
