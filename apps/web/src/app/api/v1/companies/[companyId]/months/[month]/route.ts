import { getMonthView } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; month: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, month } = await params;
  return handle(request, (ctx) => getMonthView(ctx, companyId, month));
}
