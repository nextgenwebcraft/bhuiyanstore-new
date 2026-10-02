import {
  createImportJob,
  inspectImportWorkbook,
  listImportJobs,
  MAX_IMPORT_WORKBOOK_BYTES,
} from "@bsd/application";
import { handle, idempotencyKey, readBytes } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, (ctx) => listImportJobs(ctx, companyId));
}

/**
 * The workbook is the raw request body. Without `sheet` the upload is only inspected (its month
 * sheets are listed); with `sheet` that month is read into a new import job.
 */
export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  return handle(
    request,
    async (ctx) => {
      const data = await readBytes(request, MAX_IMPORT_WORKBOOK_BYTES);
      const sheet = query.get("sheet");
      if (sheet === null) return inspectImportWorkbook(ctx, companyId, data);
      return createImportJob(
        ctx,
        companyId,
        {
          data,
          fileName: query.get("fileName") ?? "",
          sheet,
          extraBlocks: query.get("extraBlocks") === "lastDay" ? "lastDay" : "ignore",
        },
        idempotencyKey(request),
      );
    },
    200,
    { body: "xlsx" },
  );
}
