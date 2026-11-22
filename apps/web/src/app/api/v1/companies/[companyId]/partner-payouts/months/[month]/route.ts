import { getPartnerPayoutMonth } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; month: string }> };

/** D143: one month of partner payments: live shares plus recorded payments. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, month } = await params;
  return handle(request, (ctx) => getPartnerPayoutMonth(ctx, companyId, month));
}
