import { createHash } from "node:crypto";
import { Prisma } from "@bsd/database";
import { requestKeySchema } from "@bsd/contracts";
import type { AppContext, Tx } from "./context";
import { AppError } from "./errors";

export type IdempotencyKey = {
  /** A company ID, or "tenant" for tenant-level commands. */
  scope: string;
  action: string;
  requestKey?: string | undefined;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function payloadHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Runs a write in one transaction, at most once per actor/scope/action/request key
 * (guide §13.3). A retry with the same payload returns the stored response; a different
 * payload fails with IDEMPOTENCY_CONFLICT. Without a key the write simply runs once.
 */
export async function runIdempotent<T>(
  ctx: AppContext,
  key: IdempotencyKey,
  payload: unknown,
  write: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (key.requestKey === undefined) return ctx.db.$transaction(write);
  const requestKey = requestKeySchema.safeParse(key.requestKey);
  if (!requestKey.success) {
    throw new AppError("VALIDATION_FAILED", [
      { path: "requestKey", code: "validation.requestKey" },
    ]);
  }
  const where = {
    actorId_scope_action_requestKey: {
      actorId: ctx.actor.userId,
      scope: key.scope,
      action: key.action,
      requestKey: requestKey.data,
    },
  };
  const hash = payloadHash(payload);
  const replay = async (): Promise<T | undefined> => {
    const record = await ctx.db.idempotencyRecord.findUnique({ where });
    if (!record) return undefined;
    if (record.payloadHash !== hash) throw new AppError("IDEMPOTENCY_CONFLICT");
    return record.response as T;
  };

  const previous = await replay();
  if (previous !== undefined) return previous;
  try {
    return await ctx.db.$transaction(async (tx) => {
      const result = await write(tx);
      await tx.idempotencyRecord.create({
        data: {
          ...where.actorId_scope_action_requestKey,
          payloadHash: hash,
          response: result as Prisma.InputJsonValue,
        },
      });
      return result;
    });
  } catch (error) {
    // A concurrent request with the same key won the race: return its outcome.
    if (isUniqueViolation(error)) {
      const winner = await replay();
      if (winner !== undefined) return winner;
    }
    throw error;
  }
}
