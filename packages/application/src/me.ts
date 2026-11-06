import { APIError, type Auth } from "@bsd/auth";
import { meSchema, passwordChangeRequestSchema, type Me } from "@bsd/contracts";
import type { AppContext } from "./context";
import { AppError, parseInput } from "./errors";

export async function getMe(ctx: AppContext): Promise<Me> {
  const user = await ctx.db.user.findUnique({ where: { id: ctx.actor.userId } });
  if (!user) throw new AppError("UNAUTHENTICATED");
  return meSchema.parse({
    id: user.id,
    name: user.name,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
  });
}

/**
 * Verifies the current password and stores the new one through Better Auth (other sessions are
 * revoked). Voluntary change only — there is no forced first-sign-in gate (D117).
 */
export async function changePassword(
  ctx: AppContext,
  auth: Auth,
  headers: Headers,
  input: unknown,
): Promise<void> {
  const data = parseInput(passwordChangeRequestSchema, input);
  if (data.newPassword === data.currentPassword) {
    throw new AppError("VALIDATION_FAILED", [
      { path: "newPassword", code: "validation.password.unchanged" },
    ]);
  }
  try {
    await auth.api.changePassword({
      headers,
      body: { ...data, revokeOtherSessions: true },
    });
  } catch (error) {
    if (error instanceof APIError && error.statusCode < 500) {
      throw new AppError("VALIDATION_FAILED", [
        { path: "currentPassword", code: "validation.password.incorrect" },
      ]);
    }
    throw error;
  }
  await ctx.db.auditEvent.create({
    data: {
      tenantId: ctx.actor.tenantId,
      actorId: ctx.actor.userId,
      action: "user.password_changed",
      resourceType: "user",
      resourceId: ctx.actor.userId,
      requestId: ctx.requestId,
    },
  });
}
