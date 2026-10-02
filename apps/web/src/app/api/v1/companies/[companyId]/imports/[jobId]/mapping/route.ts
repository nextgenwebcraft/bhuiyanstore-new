import { saveImportMapping } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; jobId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, jobId } = await params;
  return handle(request, async (ctx) =>
    saveImportMapping(ctx, companyId, jobId, await readJson(request), idempotencyKey(request)),
  );
}
