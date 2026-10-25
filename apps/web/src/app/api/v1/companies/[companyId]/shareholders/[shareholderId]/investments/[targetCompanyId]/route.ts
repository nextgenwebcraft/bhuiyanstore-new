import { saveInvestment } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = {
  params: Promise<{ companyId: string; shareholderId: string; targetCompanyId: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const { companyId, shareholderId, targetCompanyId } = await params;
  return handle(request, async (ctx) =>
    saveInvestment(
      ctx,
      companyId,
      shareholderId,
      targetCompanyId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}
