import { createDamageCase, listDamageCases } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** `?status=open` hides settled and cancelled cases. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const status = new URL(request.url).searchParams.get("status");
  return handle(request, (ctx) => listDamageCases(ctx, companyId, { status }));
}

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(
    request,
    async (ctx) =>
      createDamageCase(ctx, companyId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
