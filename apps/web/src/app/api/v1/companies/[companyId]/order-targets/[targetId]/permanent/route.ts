import { deleteOrderTarget } from "@bsd/application";
import { handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; targetId: string }> };

/** D147: permanent delete of a target, Super Admin only. Archive stays on the parent DELETE. */
export async function DELETE(request: Request, { params }: Params) {
  const { companyId, targetId } = await params;
  return handle(request, (ctx) => deleteOrderTarget(ctx, companyId, targetId));
}
