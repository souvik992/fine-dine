const API_BASE = (import.meta.env.VITE_SAAS_API_URL || "http://localhost:4100").replace(/\/+$/, "");

export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error?: { code?: string; message?: string } };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: (() => { const headers = new Headers(init.headers); headers.set("content-type", "application/json"); return headers; })(),
    });
  } catch {
    throw new ApiError("Unable to reach Fine Dine. Check your connection and try again.", 0);
  }
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || !payload.success) {
    const failure = payload && !payload.success ? payload.error : undefined;
    throw new ApiError(failure?.message || "Something went wrong. Please try again.", response.status, failure?.code);
  }
  return payload.data;
}

export function idempotencyKey(): string {
  return `fdreg_${crypto.randomUUID()}`;
}
