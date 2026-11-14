import {
  AppError,
  approveDsrHandover,
  discardDsrDay,
  postDsrDay,
  reverseDsrDay,
  submitDsrHandover,
} from "@bsd/application";
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
    if (action === "handover-submit") {
      return submitDsrHandover(ctx, companyId, dayId, input, idempotencyKey(request));
    }
    if (action === "handover-approve") {
      return approveDsrHandover(ctx, companyId, dayId, input, idempotencyKey(request));
    }
    throw new AppError("VALIDATION_FAILED", [{ path: "action", code: "validation.action" }]);
  });
}
