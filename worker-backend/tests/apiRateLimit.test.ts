import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index.js";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const limiter = (success: boolean) => ({ limit: async () => ({ success }) }) as unknown as RateLimit;
const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://api.example${path}`, {
    ...init,
    headers: { "CF-Connecting-IP": "203.0.113.1", Origin: "https://evil.example", ...init.headers },
  });

describe("public api rate limit", () => {
  it("returns 429 when the limiter rejects", async () => {
    const env = { API_READ_LIMITER: limiter(false) } as Env;
    const res = await worker.fetch(request("/api/festivals?lat=37&lng=127"), env, ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("uses the write limiter for POST", async () => {
    const env = { API_READ_LIMITER: limiter(true), API_WRITE_LIMITER: limiter(false) } as Env;
    const res = await worker.fetch(request("/api/analytics", { method: "POST", body: "{}" }), env, ctx);
    expect(res.status).toBe(429);
  });

  it("passes through when the binding is absent and sends no CORS headers", async () => {
    const res = await worker.fetch(request("/api/festivals?lat=37&lng=127"), {} as Env, ctx);
    expect(res.status).not.toBe(429);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not limit admin routes", async () => {
    const env = { API_READ_LIMITER: limiter(false), API_WRITE_LIMITER: limiter(false) } as Env;
    const res = await worker.fetch(request("/api/admin/event-reports"), env, ctx);
    expect(res.status).not.toBe(429);
  });
});
