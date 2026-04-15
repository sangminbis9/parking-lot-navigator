import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/createApp.js";

describe("discover APIs", () => {
  it("returns nearby festivals", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/discover/festivals?lat=37.5665&lng=126.9780&radiusMeters=3000"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
    expect(response.json().items[0].status).toBe("ongoing");
    await app.close();
  });

  it("returns nearby free events", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/discover/events?lat=37.5665&lng=126.9780&radiusMeters=3000"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
    expect(response.json().items[0].isFree).toBe(true);
    await app.close();
  });

  it("records selected destinations without storing raw typed search streams", async () => {
    const app = await createApp();
    const created = await app.inject({
      method: "POST",
      url: "/analytics/search-history",
      payload: {
        deviceId: "test-device-123",
        queryText: "서울역",
        destinationId: "dest-seoul-station",
        destinationName: "서울역",
        address: "서울 중구 한강대로 405",
        lat: 37.5547,
        lng: 126.9706,
        rawCategory: "교통 > 기차역",
        provider: "kakao-local"
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().normalizedCategory).toBe("station");

    const stats = await app.inject({
      method: "GET",
      url: "/analytics/search-history/stats?deviceId=test-device-123"
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().topCategories[0].category).toBe("station");
    await app.close();
  });
});
