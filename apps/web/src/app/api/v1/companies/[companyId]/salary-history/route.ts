import { listSalaryHistory } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** D149 History → বেতন ইতিহাস for `?year=YYYY[&month=YYYY-MM][&staffId=…]`. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const search = new URL(request.url).searchParams;
  const query = {
    year: search.get("year"),
    month: search.get("month"),
    staffId: search.get("staffId"),
  };
  return handle(request, (ctx) => listSalaryHistory(ctx, companyId, query));
}
