import { getDashboardSummary } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const date = new URL(request.url).searchParams.get("date");
  return handle(request, (ctx) => getDashboardSummary(ctx, companyId, date));
}
