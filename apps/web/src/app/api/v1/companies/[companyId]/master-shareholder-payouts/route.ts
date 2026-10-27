import { setShareholderPayout } from "@bsd/application";
import { handle, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** D94: marks or unmarks one shareholder's one month as paid on the master panel. */
export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    setShareholderPayout(ctx, companyId, await readJson(request)),
  );
}
