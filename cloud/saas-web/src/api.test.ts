import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("sends credentialed JSON requests and preserves caller headers", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, data: { registered: true } }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/v1/auth/register", {
      method: "POST",
      headers: { "Idempotency-Key": "fdreg_test-key-12345678" },
      body: JSON.stringify({}),
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:4100/api/v1/auth/register");
    expect(init?.credentials).toBe("include");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe("fdreg_test-key-12345678");
  });

  it("surfaces API error messages and codes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        success: false,
        error: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email first." },
      }), { status: 403 }),
    ));

    await expect(apiRequest("/api/v1/auth/login")).rejects.toMatchObject({
      message: "Verify your email first.",
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
    });
  });
});
