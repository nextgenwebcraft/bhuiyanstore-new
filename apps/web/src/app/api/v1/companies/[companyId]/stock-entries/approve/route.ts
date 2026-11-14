import { approvePendingOrders } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  const body = (await readJson(request)) as { date?: unknown };
  return handle(
    request,
    (ctx) => approvePendingOrders(ctx, companyId, body.date, idempotencyKey(request)),
    200,
  );
}
