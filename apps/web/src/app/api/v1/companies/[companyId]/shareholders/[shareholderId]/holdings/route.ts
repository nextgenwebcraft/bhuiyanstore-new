import { saveShareHolding } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; shareholderId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, shareholderId } = await params;
  return handle(request, async (ctx) =>
    saveShareHolding(
      ctx,
      companyId,
      shareholderId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}
