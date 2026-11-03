import { listHistoryMoneyEntries } from "@bsd/application";
import { historyMoneyKindGroups, type HistoryMoneyKindGroup } from "@bsd/contracts";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  const group = query.get("group") as HistoryMoneyKindGroup;
  if (!(group in historyMoneyKindGroups)) {
    return Response.json({ error: { code: "VALIDATION_FAILED", message: "group" } }, { status: 400 });
  }
  return handle(request, (ctx) =>
    listHistoryMoneyEntries(ctx, companyId, group, {
      page: query.get("page") ?? undefined,
      pageSize: query.get("pageSize") ?? undefined,
      date: query.get("date") ?? undefined,
      status: query.get("status") ?? undefined,
    }),
  );
}
