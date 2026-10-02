import { createRole, listRoles } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

export function GET(request: Request) {
  return handle(request, (ctx) => listRoles(ctx));
}

export function POST(request: Request) {
  return handle(
    request,
    async (ctx) => createRole(ctx, await readJson(request), idempotencyKey(request)),
    201,
  );
}
