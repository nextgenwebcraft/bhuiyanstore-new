import { z } from "zod";
import { errorCodes } from "./definitions/error-codes";

export const apiErrorSchema = z.object({
  code: z.enum(errorCodes),
  requestId: z.string().optional(),
  retryable: z.boolean(),
  fieldErrors: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
