import { listHistoryStockDateSummaries } from "@bsd/application";
import { historyStockKindGroups, type HistoryStockKindGroup } from "@bsd/contracts";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  const group = query.get("group") as HistoryStockKindGroup;
  if (!(group in historyStockKindGroups)) {
    return Response.json({ error: { code: "VALIDATION_FAILED", message: "group" } }, { status: 400 });
  }
  return handle(request, (ctx) =>
    listHistoryStockDateSummaries(ctx, companyId, group, {
      status: query.get("status") ?? undefined,
    }),
  );
}
