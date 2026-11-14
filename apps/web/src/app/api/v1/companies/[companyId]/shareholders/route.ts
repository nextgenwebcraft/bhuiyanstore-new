import { createShareholder, listShareholders } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  return handle(request, (ctx) => listShareholders(ctx, companyId, month));
}

export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) =>
    createShareholder(ctx, companyId, await readJson(request), idempotencyKey(request)),
  );
}
