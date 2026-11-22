import { payPartners } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** D143: pays one or more partners for a month (snapshot of each live share). */
export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    payPartners(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
