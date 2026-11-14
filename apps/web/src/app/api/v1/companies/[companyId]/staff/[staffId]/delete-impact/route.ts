import { getStaffDeleteImpact } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

/** D116: what deleting this person will wipe, for the confirm alert. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(request, (ctx) => getStaffDeleteImpact(ctx, companyId, staffId));
}
