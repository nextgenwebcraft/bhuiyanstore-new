import { exportReport, getReport } from "@bsd/application";
import { fileResponse, handle } from "@/server/api";

type Params = { params: Promise<{ companyId: string; report: string }> };

/** `?from&to`; add `format=csv|xlsx` for a download. */
export async function GET(request: Request, { params }: Params) {
  const { companyId, report } = await params;
  const search = new URL(request.url).searchParams;
  const query = { from: search.get("from"), to: search.get("to") };
  const format = search.get("format");
  return handle(request, async (ctx) => {
    if (format === null) return getReport(ctx, companyId, report, query);
    const file = await exportReport(ctx, companyId, report, query, format);
    return fileResponse(file.fileName, file.contentType, file.data);
  });
}
