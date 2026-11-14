import { getMe } from "@bsd/application";
import { handle } from "@/server/api";

export function GET(request: Request) {
  return handle(request, (ctx) => getMe(ctx));
}
