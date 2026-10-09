import { deleteFieldVisit, saveFieldVisit } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; visitId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { companyId, visitId } = await params;
  return handle(request, async (ctx) =>
    saveFieldVisit(ctx, companyId, visitId, await readJson(request), idempotencyKey(request)),
  );
}

/** Deletes an open visit; the body carries the version being deleted. */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, visitId } = await params;
  return handle(request, async (ctx) =>
    deleteFieldVisit(ctx, companyId, visitId, await readJson(request)),
  );
}
