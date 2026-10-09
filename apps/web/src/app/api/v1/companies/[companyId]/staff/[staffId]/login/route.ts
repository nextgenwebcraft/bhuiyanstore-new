import { createStaffLogin } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

/** Super-admin: a field-panel sign-in for this DSR (D40). */
export async function POST(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(
    request,
    async (ctx) =>
      createStaffLogin(ctx, companyId, staffId, await readJson(request), idempotencyKey(request)),
    201,
  );
}
