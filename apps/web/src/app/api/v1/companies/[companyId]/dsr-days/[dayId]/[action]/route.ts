import { AppError, discardDsrDay, postDsrDay, reverseDsrDay } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; dayId: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, dayId, action } = await params;
  return handle(request, async (ctx) => {
    const input = await readJson(request);
    if (action === "post") return postDsrDay(ctx, companyId, dayId, input, idempotencyKey(request));
    if (action === "reverse") {
      return reverseDsrDay(ctx, companyId, dayId, input, idempotencyKey(request));
    }
    if (action === "discard") return discardDsrDay(ctx, companyId, dayId, input);
    throw new AppError("VALIDATION_FAILED", [{ path: "action", code: "validation.action" }]);
  });
}
