import { saveOpeningCutoff } from "@bsd/application";
import { handle, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) => saveOpeningCutoff(ctx, companyId, await readJson(request)));
}
