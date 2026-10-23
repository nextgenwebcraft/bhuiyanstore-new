import { getShareMonth } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; month: string }> };

/** D76: the master monthly account for one month. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, month } = await params;
  return handle(request, (ctx) => getShareMonth(ctx, companyId, month));
}
