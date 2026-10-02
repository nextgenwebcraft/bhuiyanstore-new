import { createUser, listUsers } from "@bsd/application";
import { handle, idempotencyKey, readJson } from "@/server/api";

export function GET(request: Request) {
  return handle(request, (ctx) => listUsers(ctx));
}

export function POST(request: Request) {
  return handle(
    request,
    async (ctx) => createUser(ctx, await readJson(request), idempotencyKey(request)),
    201,
  );
}
