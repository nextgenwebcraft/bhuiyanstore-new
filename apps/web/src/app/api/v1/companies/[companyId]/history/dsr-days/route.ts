import { listHistoryDsrDays } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  return handle(request, (ctx) =>
    listHistoryDsrDays(ctx, companyId, {
      page: query.get("page") ?? undefined,
      pageSize: query.get("pageSize") ?? undefined,
      date: query.get("date") ?? undefined,
      status: query.get("status") ?? undefined,
    }),
  );
}
