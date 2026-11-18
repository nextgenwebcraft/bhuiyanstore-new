import { listStockTrackingProducts } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const url = new URL(request.url);
  return handle(request, (ctx) =>
    listStockTrackingProducts(ctx, companyId, {
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize"),
      q: url.searchParams.get("q") ?? "",
    }),
  );
}
