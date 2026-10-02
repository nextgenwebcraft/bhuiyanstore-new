import { listDsrDays, saveDsrDay } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const date = new URL(request.url).searchParams.get("date");
  return handle(request, (ctx) => listDsrDays(ctx, companyId, date));
}

/** Creates or replaces the DSR's draft sheet for the date. */
export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    saveDsrDay(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
