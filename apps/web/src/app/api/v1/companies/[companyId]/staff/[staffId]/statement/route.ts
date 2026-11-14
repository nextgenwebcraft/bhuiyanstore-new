import { exportStaffStatement, getStaffStatement } from "@bsd/application";
import { fileResponse, handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; staffId: string }> };

/** `?from&to`; add `format=csv|xlsx` for a download. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, staffId } = await params;
  const search = new URL(request.url).searchParams;
  const query = { from: search.get("from"), to: search.get("to") };
  const format = search.get("format");
  return handle(request, async (ctx) => {
    if (format === null) return getStaffStatement(ctx, companyId, staffId, query);
    const file = await exportStaffStatement(ctx, companyId, staffId, query, format);
    return fileResponse(file.fileName, file.contentType, file.data);
  });
}
