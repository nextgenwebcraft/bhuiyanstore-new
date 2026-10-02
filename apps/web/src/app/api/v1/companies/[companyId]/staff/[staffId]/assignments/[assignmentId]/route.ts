import { updateStaffAssignment } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = {
  params: Promise<{ companyId: string; staffId: string; assignmentId: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  const { companyId, staffId, assignmentId } = await params;
  return handle(request, async (ctx) =>
    updateStaffAssignment(
      ctx,
      companyId,
      staffId,
      assignmentId,
      await readJson(request),
      idempotencyKey(request),
    ),
  );
}
