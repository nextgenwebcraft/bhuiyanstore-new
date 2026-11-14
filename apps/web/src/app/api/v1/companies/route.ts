import { createCompany, listWorkspaces } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

export function GET(request: Request) {
  return handle(request, (ctx) => listWorkspaces(ctx));
}

export function POST(request: Request) {
  return handle(
    request,
    async (ctx) => createCompany(ctx, await readJson(request), idempotencyKey(request)),
    201,
  );
}
