import { createStaffLogin, updateStaffLogin } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

/** Super-admin: create a Manager/DSR login linked to this staff person (D113). */
export async function POST(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(
    request,
    async (ctx) =>
      createStaffLogin(ctx, companyId, staffId, await readJson(request), idempotencyKey(request)),
    201,
  );
}

/** Super-admin: update role, company access or active flag (D113). */
export async function PUT(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(request, async (ctx) =>
    updateStaffLogin(ctx, companyId, staffId, await readJson(request), idempotencyKey(request)),
  );
}
