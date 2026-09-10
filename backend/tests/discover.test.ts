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

  it("returns local store events separately from public festival data", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/local-events?lat=37.5665&lng=126.9780&radiusMeters=3000"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
    expect(response.json().items[0].category).toBe("local_event");
    expect(response.json().items[0].source).toBe("owner_submitted");
    await app.close();
  });

  it("keeps legacy discover events endpoint compatible for older app builds", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/discover/events?lat=37.5665&lng=126.9780&radiusMeters=3000"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
    await app.close();
  });

  it("accepts user reports as pending local events", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/local-events/report",
      payload: {
        sourceUrl: "https://www.instagram.com/p/example/",
        captionText: "Sample Cafe review event. Free americano for review. 5월 한정",
        storeName: "Sample Cafe",
        address: "110 Sejong-daero, Jung-gu, Seoul"
      }
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().item.status).toBe("pending");
    expect(response.json().item.needsReview).toBe(true);
    await app.close();
  });

  it("returns unified map items with distinct festival and event marker types", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/map/items?type=all&lat=37.5665&lng=126.9780&radiusMeters=3000"
    });
    expect(response.statusCode).toBe(200);
    const markerTypes = response.json().items.map((item: { markerType: string }) => item.markerType);
    expect(markerTypes).toContain("festival");
    expect(markerTypes).toContain("local_event");
    await app.close();
  });
});
