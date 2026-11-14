import { getStaffAccounts } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** `?kind=distributor|sr&date=` balances at the end of the date (default today). */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const search = new URL(request.url).searchParams;
  return handle(request, (ctx) =>
    getStaffAccounts(ctx, companyId, { kind: search.get("kind"), date: search.get("date") }),
  );
}
