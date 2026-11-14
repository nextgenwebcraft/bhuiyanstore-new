import { getDamageCase } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; caseId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, caseId } = await params;
  return handle(request, (ctx) => getDamageCase(ctx, companyId, caseId));
}
