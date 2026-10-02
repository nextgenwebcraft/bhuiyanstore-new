import { openingTemplate } from "@bsd/application";
import { handle, xlsxResponse } from "@/server/api";

type Params = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { companyId } = await params;
  return handle(request, async (ctx) => {
    const { fileName, data } = await openingTemplate(ctx, companyId);
    return xlsxResponse(fileName, data);
  });
}
