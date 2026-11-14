import type { Prisma } from "@bsd/database";
import type { AppContext, Tx } from "./context";

export type AuditInput = {
  companyId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
};

/** Appends one audit row inside the write's transaction (the table rejects updates and deletes). */
export async function recordAudit(tx: Tx, ctx: AppContext, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: ctx.actor.tenantId,
      companyId: input.companyId ?? null,
      actorId: ctx.actor.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: ctx.requestId,
      ...(input.before === undefined ? {} : { before: input.before as Prisma.InputJsonValue }),
      ...(input.after === undefined ? {} : { after: input.after as Prisma.InputJsonValue }),
    },
  });
}
