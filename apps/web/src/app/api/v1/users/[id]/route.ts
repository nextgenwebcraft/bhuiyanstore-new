import { updateUser } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return handle(request, async (ctx) =>
    updateUser(ctx, id, await readJson(request), idempotencyKey(request)),
  );
}
