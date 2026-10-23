import { saveSharePolicy } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; targetCompanyId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, targetCompanyId } = await params;
  return handle(request, async (ctx) =>
    saveSharePolicy(
      ctx,
      companyId,
      targetCompanyId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}
