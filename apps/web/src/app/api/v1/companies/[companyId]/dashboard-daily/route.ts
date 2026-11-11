import { getDashboardDaily } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, (ctx) => getDashboardDaily(ctx, companyId));
}
