import { saveInvestments } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; shareholderId: string }> };

/** Saves every invest entry a শেয়ারহোল্ডার screen edit touches, as one atomic transaction. */
export async function PUT(request: Request, { params }: Params) {
  const { companyId, shareholderId } = await params;
  return handle(request, async (ctx) =>
    saveInvestments(
      ctx,
      companyId,
      shareholderId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}
