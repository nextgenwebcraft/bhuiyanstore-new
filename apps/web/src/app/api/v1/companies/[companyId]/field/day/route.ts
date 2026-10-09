import { getDsrFieldDay, getFieldDay } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** The signed-in DSR's field day, or with `staffId` the office's read of that DSR's day. */
export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  const date = query.get("date");
  const staffId = query.get("staffId");
  return handle(request, (ctx) =>
    staffId ? getDsrFieldDay(ctx, companyId, staffId, date) : getFieldDay(ctx, companyId, date),
  );
}
