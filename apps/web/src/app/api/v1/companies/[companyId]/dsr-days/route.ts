import { listDraftDsrDays, listDsrDays, saveDsrDay } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const search = new URL(request.url).searchParams;
  // `?drafts=1`: all open drafts of any date (stock reservation view).
  if (search.get("drafts") === "1") {
    return handle(request, (ctx) => listDraftDsrDays(ctx, companyId));
  }
  const date = search.get("date");
  return handle(request, (ctx) => listDsrDays(ctx, companyId, date));
}

/** Creates or replaces the DSR's draft sheet for the date. */
export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    saveDsrDay(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
