import { getPayrollRun, savePayrollRun } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; month: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, month } = await params;
  return handle(request, (ctx) => getPayrollRun(ctx, companyId, month));
}

export async function PUT(request: Request, { params }: Params) {
  const { companyId, month } = await params;
  return handle(request, async (ctx) =>
    savePayrollRun(ctx, companyId, month, await readJson(request), idempotencyKey(request)),
  );
}
