import { saveFieldVisit } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(
    request,
    async (ctx) =>
      saveFieldVisit(ctx, companyId, undefined, await readJson(request), idempotencyKey(request)),
    201,
  );
}
