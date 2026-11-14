import { getDayView } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; date: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, date } = await params;
  return handle(request, (ctx) => getDayView(ctx, companyId, date));
}
