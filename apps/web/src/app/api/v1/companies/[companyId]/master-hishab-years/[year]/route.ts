import { getMasterHishabYear } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; year: string }> };

/** The master panel: every company's total side by side, for a year and (optionally) a shareholder. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, year } = await params;
  const shareholderId = new URL(request.url).searchParams.get("shareholderId") ?? undefined;
  return handle(request, (ctx) => getMasterHishabYear(ctx, companyId, year, shareholderId));
}
