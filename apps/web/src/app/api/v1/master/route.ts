import { getMasterWorkspace } from "@bsd/application";
import { handle } from "@/server/api";

export function GET(request: Request) {
  return handle(request, (ctx) => getMasterWorkspace(ctx));
}
