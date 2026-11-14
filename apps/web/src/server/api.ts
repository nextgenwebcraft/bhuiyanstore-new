import "server-only";
import { AppError, HTTP_STATUS, type AppContext } from "@bsd/application";
import { actorFromHeaders, auth } from "@bsd/auth";
import { database } from "@bsd/database";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Every answer is per-user business data: never stored by a browser or shared cache. */
const NO_STORE = { "cache-control": "private, no-store" };

function errorResponse(error: AppError, requestId: string): Response {
  return Response.json(error.toApiError(requestId), {
    status: HTTP_STATUS[error.code],
    headers: NO_STORE,
  });
}

/**
 * Writes only accept same-origin JSON. That is not a type an HTML form can send, so a cross-site
 * form cannot ride the session cookie.
 */
function assertSameOriginBody(request: Request): void {
  if (!UNSAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    throw new AppError("FORBIDDEN");
  }
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", [{ path: "", code: "validation.json.required" }]);
  }
}

/**
 * Runs one `/api/v1` request: resolves the session actor, maps `AppError` to an `ApiError`
 * response and hides unexpected failures behind INTERNAL with a request id for the logs.
 * A handler may return its own `Response` (file downloads).
 */
export async function handle(
  request: Request,
  run: (ctx: AppContext) => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    assertSameOriginBody(request);
    const db = database();
    const actor = await actorFromHeaders(auth(), db, request.headers);
    if (!actor) throw new AppError("UNAUTHENTICATED");
    const result = await run({ db, actor, requestId });
    if (result instanceof Response) return result;
    return result === undefined
      ? new Response(null, { status: 204, headers: NO_STORE })
      : Response.json(result, { status: successStatus, headers: NO_STORE });
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error, requestId);
    console.error(`[api] ${request.method} ${new URL(request.url).pathname} ${requestId}`, error);
    return errorResponse(new AppError("INTERNAL", undefined, true), requestId);
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", [{ path: "", code: "validation.json.invalid" }]);
  }
}

/** A file download; the name is ASCII-safe in `filename` and exact in `filename*`. */
export function fileResponse(fileName: string, contentType: string, data: Uint8Array): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(data as unknown as BodyInit, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "no-store",
    },
  });
}

export function idempotencyKey(request: Request): string | undefined {
  return request.headers.get("idempotency-key")?.trim() || undefined;
}

type TenantListService = {
  list(ctx: AppContext): Promise<unknown>;
  create(ctx: AppContext, input: unknown, requestKey?: string): Promise<unknown>;
  update(ctx: AppContext, id: string, input: unknown, requestKey?: string): Promise<unknown>;
};

type IdParams = { params: Promise<{ id: string }> };

/** GET/POST for a tenant configuration list (staff roles, expense categories, cash accounts). */
export function tenantListRoutes(service: TenantListService) {
  return {
    GET: (request: Request) => handle(request, (ctx) => service.list(ctx)),
    POST: (request: Request) =>
      handle(
        request,
        async (ctx) => service.create(ctx, await readJson(request), idempotencyKey(request)),
        201,
      ),
  };
}

/** PUT for one entry of a tenant configuration list. */
export function tenantListItemRoutes(service: TenantListService) {
  return {
    PUT: async (request: Request, { params }: IdParams) => {
      const { id } = await params;
      return handle(request, async (ctx) =>
        service.update(ctx, id, await readJson(request), idempotencyKey(request)),
      );
    },
  };
}
