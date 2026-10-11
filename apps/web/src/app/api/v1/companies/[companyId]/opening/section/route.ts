import { saveOpeningSection } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/** The body names its section: `stock` or one balance section. */
export async function PUT(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    saveOpeningSection(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
