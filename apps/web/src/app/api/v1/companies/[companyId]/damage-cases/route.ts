import { createDamageCase, listDamageCases } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** `?status=open` hides settled and cancelled cases; `from`/`to` bound the case date. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const search = new URL(request.url).searchParams;
  return handle(request, (ctx) =>
    listDamageCases(ctx, companyId, {
      status: search.get("status"),
      from: search.get("from"),
      to: search.get("to"),
    }),
  );
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
