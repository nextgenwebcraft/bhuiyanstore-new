import { getDashboardMonthly } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const year = new URL(request.url).searchParams.get("year");
  return handle(request, (ctx) => getDashboardMonthly(ctx, companyId, year));
}
