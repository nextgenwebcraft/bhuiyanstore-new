import { getImportJob } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; jobId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId, jobId } = await params;
  return handle(request, (ctx) => getImportJob(ctx, companyId, jobId));
}
