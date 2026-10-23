import { getShareYear } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; year: string }> };

/** D77: the master page for one year, every company side by side. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, year } = await params;
  return handle(request, (ctx) => getShareYear(ctx, companyId, year));
}
