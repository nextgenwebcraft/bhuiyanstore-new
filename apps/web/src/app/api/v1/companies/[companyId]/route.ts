import { getWorkspace, updateCompany } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, (ctx) => getWorkspace(ctx, companyId));
}

export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    updateCompany(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
