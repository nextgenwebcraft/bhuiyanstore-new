import { getShopStatement } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; shopId: string }> };

/** `?from&to`; defaults to this month up to today. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, shopId } = await params;
  const search = new URL(request.url).searchParams;
  const query = { from: search.get("from"), to: search.get("to") };
  return handle(request, (ctx) => getShopStatement(ctx, companyId, shopId, query));
}
