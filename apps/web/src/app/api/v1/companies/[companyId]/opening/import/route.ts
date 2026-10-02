import {
  AppError,
  importOpeningWorkbook,
  inspectOpeningWorkbook,
  MAX_OPENING_WORKBOOK_BYTES,
} from "@bsd/application";
import { handle, idempotencyKey, readBytes } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

/**
 * The workbook is the raw request body. Without `sheet` the upload is only inspected (its month
 * sheets are listed); with `sheet` (or a template upload, `sheet=template`) it is imported.
 */
export async function POST(request: Request, { params }: Params) {
  const { companyId } = await params;
  const query = new URL(request.url).searchParams;
  return handle(
    request,
    async (ctx) => {
      const data = await readBytes(request, MAX_OPENING_WORKBOOK_BYTES);
      const sheet = query.get("sheet");
      if (sheet === null) return inspectOpeningWorkbook(ctx, companyId, data);
      const version = Number(query.get("version"));
      if (!Number.isInteger(version) || version < 0) {
        throw new AppError("VALIDATION_FAILED", [{ path: "version", code: "validation.required" }]);
      }
      return importOpeningWorkbook(
        ctx,
        companyId,
        {
          data,
          fileName: query.get("fileName") ?? "",
          sheet: sheet === "template" ? null : sheet,
          version,
        },
        idempotencyKey(request),
      );
    },
    200,
    { body: "xlsx" },
  );
}
