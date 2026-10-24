import { saveOpeningSection } from "@bsd/application";
import { handle, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; section: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, section } = await params;
  const body = await readJson(request);
  return handle(request, (ctx) =>
    saveOpeningSection(ctx, companyId, { ...(body as object), section }),
  );
}
