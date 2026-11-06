import { resetStaffLoginPassword } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

/** Super-admin: password reset for a staff-linked login (D113 / D117). */
export async function POST(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  return handle(request, async (ctx) =>
    resetStaffLoginPassword(
      ctx,
      companyId,
      staffId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}
