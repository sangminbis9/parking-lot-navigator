import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/createApp.js";

describe("API happy-path 통합 테스트", () => {
  it("검색 후 주변 주차장 목록을 반환한다", async () => {
    const app = await createApp();
    const search = await app.inject({ method: "GET", url: "/search/destination?q=서울역" });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json();
    expect(searchBody.items.length).toBeGreaterThan(0);

    const first = searchBody.items[0];
    const parking = await app.inject({
      method: "GET",
      url: `/parking/nearby?lat=${first.lat}&lng=${first.lng}&radiusMeters=800`
    });
    expect(parking.statusCode).toBe(200);
    expect(parking.json().items.length).toBeGreaterThan(0);
    await app.close();
  });

  it("provider health를 반환한다", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/parking/providers/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().providers.length).toBeGreaterThan(0);
    await app.close();
  });
});
