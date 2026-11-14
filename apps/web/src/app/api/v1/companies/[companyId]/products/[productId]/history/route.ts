import { getProductHistory } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; productId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, productId } = await params;
  return handle(request, (ctx) => getProductHistory(ctx, companyId, productId));
}
