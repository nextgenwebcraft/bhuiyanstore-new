import { getDashboardDaily } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const month = new URL(request.url).searchParams.get("month");
  return handle(request, (ctx) => getDashboardDaily(ctx, companyId, month));
}
