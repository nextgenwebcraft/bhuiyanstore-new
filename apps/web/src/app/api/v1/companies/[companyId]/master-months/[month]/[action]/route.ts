import { AppError, closeMonthAll, reopenMonthAll } from "@bsd/application";
import { handle, idempotencyKey } from "@/server/api";

type Params = { params: Promise<{ companyId: string; month: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, month, action } = await params;
  return handle(request, async (ctx) => {
    if (action === "close") return closeMonthAll(ctx, companyId, month, idempotencyKey(request));
    if (action === "reopen") return reopenMonthAll(ctx, companyId, month, idempotencyKey(request));
    throw new AppError("VALIDATION_FAILED", [{ path: "action", code: "validation.action" }]);
  });
}
