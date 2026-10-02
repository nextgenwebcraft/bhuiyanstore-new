import { discardImportJob } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; jobId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, jobId } = await params;
  return handle(request, async (ctx) =>
    discardImportJob(ctx, companyId, jobId, await readJson(request), idempotencyKey(request)),
  );
}
