import { listMoneyEntries, postMoneyEntry } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  return handle(request, (ctx) =>
    listMoneyEntries(ctx, companyId, {
      from: query.get("from") ?? query.get("date"),
      to: query.get("to"),
      staffId: query.get("staffId"),
      shopId: query.get("shopId"),
    }),
  );
}

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(
    request,
    async (ctx) => postMoneyEntry(ctx, companyId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
