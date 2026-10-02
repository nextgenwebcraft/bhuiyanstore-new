import { cancelDamageCase } from "@bsd/application";
import { handle, idempotencyKey } from "@/server/api";

type Params = { params: Promise<{ companyId: string; caseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, caseId } = await params;
  return handle(request, (ctx) =>
    cancelDamageCase(ctx, companyId, caseId, idempotencyKey(request)),
  );
}
