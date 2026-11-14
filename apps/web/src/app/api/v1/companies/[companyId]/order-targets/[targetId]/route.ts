import { archiveOrderTarget, updateOrderTarget } from "@bsd/application";
import { handle, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; targetId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, targetId } = await params;
  const body = await readJson(request);
  return handle(request, (ctx) => updateOrderTarget(ctx, companyId, targetId, body));
}

export async function DELETE(request: Request, { params }: Params) {
  const { companyId, targetId } = await params;
  return handle(request, (ctx) => archiveOrderTarget(ctx, companyId, targetId));
}
