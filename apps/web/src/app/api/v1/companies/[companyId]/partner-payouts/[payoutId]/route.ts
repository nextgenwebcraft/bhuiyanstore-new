import { cancelPartnerPayout } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; payoutId: string }> };

/** D143: cancels one recorded partner payment. */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, payoutId } = await params;
  return handle(request, (ctx) => cancelPartnerPayout(ctx, companyId, payoutId));
}
