import { AppError, approveFieldDayReport, rejectFieldDayReport } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; reportId: string; action: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, reportId, action } = await params;
  return handle(request, async (ctx) => {
    const input = await readJson(request);
    if (action === "approve") {
      return approveFieldDayReport(ctx, companyId, reportId, input, idempotencyKey(request));
    }
    if (action === "reject") return rejectFieldDayReport(ctx, companyId, reportId, input);
    throw new AppError("VALIDATION_FAILED", [{ path: "action", code: "validation.action" }]);
  });
}
