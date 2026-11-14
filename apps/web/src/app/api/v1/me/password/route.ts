import { changePassword } from "@bsd/application";
import { auth } from "@bsd/auth";
import { handle, readJson } from "@/server/api";

export function POST(request: Request) {
  return handle(request, async (ctx) =>
    changePassword(ctx, auth(), request.headers, await readJson(request)),
  );
}
