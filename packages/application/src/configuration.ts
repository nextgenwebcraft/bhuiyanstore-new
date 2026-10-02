import {
  cashAccountSchema,
  cashAccountUpsertRequestSchema,
  expenseCategorySchema,
  expenseCategoryUpsertRequestSchema,
  staffRoleSchema,
  staffRoleUpsertRequestSchema,
  type CashAccount,
  type ExpenseCategory,
  type StaffRole,
} from "@bsd/contracts";
import type { z } from "zod";
import { requireSuperAdmin } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { AppError, parseInput } from "./errors";
import { isUniqueViolation, runIdempotent } from "./idempotency";

/**
 * Tenant configuration lists (guide §4.4). Every signed-in user of the tenant can read them
 * (entry forms need them); only the super-admin changes them until delegated administration
 * exists. Entries are deactivated, never deleted.
 */
type ListSpec<Row extends { id: string; name: string }, Dto, Input extends { name: string }> = {
  resource: string;
  request: z.ZodType<Input>;
  toDto: (row: Row) => Dto;
  list: (ctx: AppContext) => Promise<Row[]>;
  find: (tx: Tx, ctx: AppContext, id: string) => Promise<Row | null>;
  findByName: (tx: Tx, ctx: AppContext, name: string) => Promise<Row | null>;
  create: (tx: Tx, ctx: AppContext, input: Input) => Promise<Row>;
  update: (tx: Tx, id: string, input: Input) => Promise<Row>;
  /** Rejects a change the fixed rules cannot accept (e.g. a used role changing kind). */
  check?: (tx: Tx, before: Row, input: Input) => Promise<void>;
};

function listService<Row extends { id: string; name: string }, Dto, Input extends { name: string }>(
  spec: ListSpec<Row, Dto, Input>,
) {
  const duplicate = () =>
    new AppError("VALIDATION_FAILED", [{ path: "name", code: "validation.list.duplicateName" }]);

  async function list(ctx: AppContext): Promise<Dto[]> {
    return (await spec.list(ctx)).map(spec.toDto);
  }

  async function create(ctx: AppContext, input: unknown, requestKey?: string): Promise<Dto> {
    requireSuperAdmin(ctx);
    const data = parseInput(spec.request, input);
    try {
      return await runIdempotent(
        ctx,
        { scope: "tenant", action: `${spec.resource}.create`, requestKey },
        data,
        async (tx) => {
          if (await spec.findByName(tx, ctx, data.name)) throw duplicate();
          const row = await spec.create(tx, ctx, data);
          const dto = spec.toDto(row);
          await recordAudit(tx, ctx, {
            action: `${spec.resource}.create`,
            resourceType: spec.resource,
            resourceId: row.id,
            after: dto,
          });
          return dto;
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate();
      throw error;
    }
  }

  async function update(
    ctx: AppContext,
    id: string,
    input: unknown,
    requestKey?: string,
  ): Promise<Dto> {
    requireSuperAdmin(ctx);
    const data = parseInput(spec.request, input);
    try {
      return await runIdempotent(
        ctx,
        { scope: "tenant", action: `${spec.resource}.update:${id}`, requestKey },
        data,
        async (tx) => {
          const before = await spec.find(tx, ctx, id);
          if (!before) {
            throw new AppError("VALIDATION_FAILED", [
              { path: "id", code: "validation.list.unknown" },
            ]);
          }
          const clash = await spec.findByName(tx, ctx, data.name);
          if (clash && clash.id !== id) throw duplicate();
          await spec.check?.(tx, before, data);
          const dto = spec.toDto(await spec.update(tx, id, data));
          await recordAudit(tx, ctx, {
            action: `${spec.resource}.update`,
            resourceType: spec.resource,
            resourceId: id,
            before: spec.toDto(before),
            after: dto,
          });
          return dto;
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicate();
      throw error;
    }
  }

  return { list, create, update };
}

type StaffRoleRow = { id: string; name: string; kind: string; active: boolean };

export const staffRoles = listService({
  resource: "staff_role",
  request: staffRoleUpsertRequestSchema,
  toDto: (row: StaffRoleRow): StaffRole => staffRoleSchema.parse(row),
  list: (ctx) =>
    ctx.db.staffRole.findMany({
      where: { tenantId: ctx.actor.tenantId },
      orderBy: { name: "asc" },
    }),
  find: (tx, ctx, id) => tx.staffRole.findFirst({ where: { id, tenantId: ctx.actor.tenantId } }),
  findByName: (tx, ctx, name) =>
    tx.staffRole.findFirst({ where: { name, tenantId: ctx.actor.tenantId } }),
  create: (tx, ctx, input) =>
    tx.staffRole.create({ data: { ...input, tenantId: ctx.actor.tenantId } }),
  update: (tx, id, input) => tx.staffRole.update({ where: { id }, data: input }),
  async check(tx, before, input) {
    if (before.kind === input.kind) return;
    if ((await tx.staffAssignment.count({ where: { roleId: before.id } })) > 0) {
      throw new AppError("VALIDATION_FAILED", [
        { path: "kind", code: "validation.staffRole.kindInUse" },
      ]);
    }
  },
});

type ExpenseCategoryRow = { id: string; name: string; active: boolean };

export const expenseCategories = listService({
  resource: "expense_category",
  request: expenseCategoryUpsertRequestSchema,
  toDto: (row: ExpenseCategoryRow): ExpenseCategory => expenseCategorySchema.parse(row),
  list: (ctx) =>
    ctx.db.expenseCategory.findMany({
      where: { tenantId: ctx.actor.tenantId },
      orderBy: { name: "asc" },
    }),
  find: (tx, ctx, id) =>
    tx.expenseCategory.findFirst({ where: { id, tenantId: ctx.actor.tenantId } }),
  findByName: (tx, ctx, name) =>
    tx.expenseCategory.findFirst({ where: { name, tenantId: ctx.actor.tenantId } }),
  create: (tx, ctx, input) =>
    tx.expenseCategory.create({ data: { ...input, tenantId: ctx.actor.tenantId } }),
  update: (tx, id, input) => tx.expenseCategory.update({ where: { id }, data: input }),
});

type CashAccountRow = { id: string; name: string; kind: string; active: boolean };

async function legalEntityId(tx: Tx, ctx: AppContext): Promise<string> {
  const entity = await tx.legalEntity.findFirst({
    where: { tenantId: ctx.actor.tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!entity) throw new AppError("INTERNAL");
  return entity.id;
}

export const cashAccounts = listService({
  resource: "cash_account",
  request: cashAccountUpsertRequestSchema,
  toDto: (row: CashAccountRow): CashAccount => cashAccountSchema.parse(row),
  list: (ctx) =>
    ctx.db.cashAccount.findMany({
      where: { tenantId: ctx.actor.tenantId },
      orderBy: { name: "asc" },
    }),
  find: (tx, ctx, id) => tx.cashAccount.findFirst({ where: { id, tenantId: ctx.actor.tenantId } }),
  findByName: (tx, ctx, name) =>
    tx.cashAccount.findFirst({ where: { name, tenantId: ctx.actor.tenantId } }),
  create: async (tx, ctx, input) =>
    tx.cashAccount.create({
      data: { ...input, tenantId: ctx.actor.tenantId, legalEntityId: await legalEntityId(tx, ctx) },
    }),
  update: (tx, id, input) => tx.cashAccount.update({ where: { id }, data: input }),
});
