import { postDamageEvent } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; caseId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, caseId } = await params;
  return handle(
    request,
    async (ctx) =>
      postDamageEvent(ctx, companyId, caseId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
