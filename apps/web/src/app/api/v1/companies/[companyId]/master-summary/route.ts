import { getMasterSummary } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const search = new URL(request.url).searchParams;
  const query = { from: search.get("from"), to: search.get("to") };
  return handle(request, (ctx) => getMasterSummary(ctx, companyId, query));
}
