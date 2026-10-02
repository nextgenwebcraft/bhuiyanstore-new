import { reverseDamageEvent } from "@bsd/application";
import { handle, idempotencyKey } from "@/server/api";

type Params = { params: Promise<{ companyId: string; eventId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { companyId, eventId } = await params;
  return handle(request, (ctx) =>
    reverseDamageEvent(ctx, companyId, eventId, idempotencyKey(request)),
  );
}
