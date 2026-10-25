import { getCompanyHishabYear } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; year: string }> };

/** Company Hishab Reports: one company's twelve months, for a year and (optionally) a shareholder. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, year } = await params;
  const search = new URL(request.url).searchParams;
  const targetCompanyId = search.get("targetCompanyId") ?? "";
  const shareholderId = search.get("shareholderId") ?? undefined;
  return handle(request, (ctx) =>
    getCompanyHishabYear(ctx, companyId, targetCompanyId, year, shareholderId),
  );
}
