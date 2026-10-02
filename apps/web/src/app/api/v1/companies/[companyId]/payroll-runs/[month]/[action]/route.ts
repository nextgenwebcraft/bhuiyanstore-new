import { payrollCommand } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; month: string; action: string }> };

/** approve | pay | reverse | discard */
export async function POST(request: Request, { params }: Params) {
  const { companyId, month, action } = await params;
  return handle(request, async (ctx) =>
    payrollCommand(ctx, companyId, month, action, await readJson(request), idempotencyKey(request)),
  );
}
