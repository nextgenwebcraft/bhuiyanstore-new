import { getMonthlySummary } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** D148 History → মাসিক সারসংক্ষেপ for `?month=YYYY-MM`. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const month = new URL(request.url).searchParams.get("month");
  return handle(request, (ctx) => getMonthlySummary(ctx, companyId, month));
}
