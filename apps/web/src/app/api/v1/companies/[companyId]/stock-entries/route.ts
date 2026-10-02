import { listStockEntries, postStockEntries } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const date = new URL(request.url).searchParams.get("date");
  return handle(request, (ctx) => listStockEntries(ctx, companyId, date));
}

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(
    request,
    async (ctx) =>
      postStockEntries(ctx, companyId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
