import { deleteStaff, updateStaff } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(request, async (ctx) =>
    updateStaff(ctx, companyId, staffId, await readJson(request), idempotencyKey(request)),
  );
}

/** Hard delete with related hishab wipe so balances recalculate (D116). */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(request, async (ctx) => deleteStaff(ctx, companyId, staffId));
}
