import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "../ports/service-error";
import { createHttpService } from "./http-service";

const entry = {
  date: "2026-11-02",
  kind: "expense",
  amount: "100",
  staffId: null,
  expenseCategoryId: "cat-1",
  allocation: null,
};

function stubFetch(...outcomes: (number | "network")[]) {
  const calls: RequestInit[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init);
    const outcome = outcomes.shift() ?? 200;
    if (outcome === "network") throw new TypeError("Failed to fetch");
    const body =
      outcome < 400 ? "{}" : JSON.stringify({ code: "INTERNAL", retryable: true, requestId: "r" });
    return new Response(body, { status: outcome, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  const keyOf = (i: number) => (calls[i]?.headers as Record<string, string>)["idempotency-key"];
  return { calls, keyOf };
}

afterEach(() => vi.unstubAllGlobals());

describe("http service idempotency keys", () => {
  it("reuses the key when an identical write is resubmitted after a network failure", async () => {
    const { keyOf } = stubFetch("network", 200);
    const service = createHttpService(() => {});
    await expect(service.postMoneyEntry("c1", entry as never)).rejects.toBeInstanceOf(ServiceError);
    await service.postMoneyEntry("c1", entry as never).catch(() => {});
    expect(keyOf(0)).toBeTruthy();
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("reuses the key after a server error, whose outcome is unknown", async () => {
    const { keyOf } = stubFetch(503, 200);
    const service = createHttpService(() => {});
    await expect(service.postMoneyEntry("c1", entry as never)).rejects.toBeInstanceOf(ServiceError);
    await service.postMoneyEntry("c1", entry as never).catch(() => {});
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it("starts a new key once the server answered", async () => {
    const { keyOf } = stubFetch(200, 200);
    const service = createHttpService(() => {});
    await service.postMoneyEntry("c1", entry as never).catch(() => {});
    await service.postMoneyEntry("c1", entry as never).catch(() => {});
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("never shares a key between different writes", async () => {
    const { keyOf } = stubFetch("network", "network");
    const service = createHttpService(() => {});
    await service.postMoneyEntry("c1", entry as never).catch(() => {});
    await service.postMoneyEntry("c1", { ...entry, amount: "200" } as never).catch(() => {});
    expect(keyOf(1)).not.toBe(keyOf(0));
  });
});

describe("http service timeouts", () => {
  it("bounds reads with a timeout signal and leaves writes unbounded", async () => {
    const { calls } = stubFetch(200, 200);
    const service = createHttpService(() => {});
    await service.listProducts("c1").catch(() => {});
    await service.postMoneyEntry("c1", entry as never).catch(() => {});
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]?.signal).toBeUndefined();
  });

  it("reports a caller's abort as REQUEST_ABORTED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const controller = new AbortController();
    controller.abort();
    const service = createHttpService(() => {});
    await expect(service.listProducts("c1", { signal: controller.signal })).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
  });
});
