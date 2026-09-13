import { describe, expect, it, vi } from "vitest";
import { saveCityFestivalAudit, type CityFestivalAudit } from "../src/cityFestivalAudit.js";

const audit: CityFestivalAudit = { siteId: "incheon-ifez", checkedAt: "2026-09-13T01:00:00Z", status: "ok",
  candidates: 3, missingTitle: 0, invalidDate: 2, belowThreshold: 1, fallbackCoordinates: 0, accepted: 0, written: 0 };
describe("private city source audit", () => {
  it("records zero-result streak privately without reading D1", async () => {
    const put = vi.fn(async () => ({}));
    const bucket = { get: async () => ({ etag: "old", json: async () => ({ checkedAt: "2026-09-12T01:00:00Z", emptyResultStreak: 2 }) }), put } as unknown as R2Bucket;
    await saveCityFestivalAudit(bucket, audit);
    expect(put.mock.calls[0][0]).toBe("internal/source-audit/incheon-ifez.json");
    expect(JSON.parse(put.mock.calls[0][1] as string)).toMatchObject({ emptyResultStreak: 3, invalidDate: 2, written: 0 });
    expect(put.mock.calls[0][2]).toEqual({ onlyIf: { etagMatches: "old" } });
  });
  it("never rolls back newer observations", async () => {
    const put = vi.fn();
    const bucket = { get: async () => ({ etag: "new", json: async () => ({ checkedAt: "2026-09-14T00:00:00Z" }) }), put } as unknown as R2Bucket;
    await saveCityFestivalAudit(bucket, audit);
    expect(put).not.toHaveBeenCalled();
  });
});
