import { createOrderTarget, listOrderTargets } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  const dashboardOnly = query.get("dashboardOnly") === "1" || query.get("dashboardOnly") === "true";
  return handle(request, (ctx) => listOrderTargets(ctx, companyId, { dashboardOnly }));
}

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  const body = await readJson(request);
  return handle(request, (ctx) => createOrderTarget(ctx, companyId, body, idempotencyKey(request)));
}
