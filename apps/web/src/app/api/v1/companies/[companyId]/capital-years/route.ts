import { getCompanyCapitalYear } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** D146 History → সারাংশ: money held in the company, today and at each month end of a year. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const year = new URL(request.url).searchParams.get("year");
  return handle(request, (ctx) => getCompanyCapitalYear(ctx, companyId, year));
}
