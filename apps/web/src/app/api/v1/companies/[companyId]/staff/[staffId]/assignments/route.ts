import { addStaffAssignment } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(
    request,
    async (ctx) =>
      addStaffAssignment(ctx, companyId, staffId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
