import { getStockTrackingProduct } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; productId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, productId } = await params;
  const url = new URL(request.url);
  return handle(request, (ctx) =>
    getStockTrackingProduct(ctx, companyId, productId, {
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize"),
    }),
  );
}
