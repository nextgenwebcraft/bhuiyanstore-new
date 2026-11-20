import { getPartnerPayoutHistory } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** D143: partner payment history for a year, optionally one partner. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const search = new URL(request.url).searchParams;
  const year = search.get("year") ?? undefined;
  const shareholderId = search.get("shareholderId") ?? undefined;
  return handle(request, (ctx) => getPartnerPayoutHistory(ctx, companyId, year, shareholderId));
}
