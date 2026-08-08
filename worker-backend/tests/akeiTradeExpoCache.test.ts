import { describe, expect, it } from "vitest";
import { mapAkeiTradeExpoRow } from "../src/akeiTradeExpoCache.js";

describe("mapAkeiTradeExpoRow", () => {
  const baseRow = {
    id: "akei:104910",
    source_url: "https://www.akei.or.kr/bbs/board.php?bo_table=schedule&wr_id=104910",
    title: "제424회 웨덱스 웨딩박람회",
    organizer: "㈜웨덱스웨딩",
    start_date: "2026-08-01",
    end_date: "2026-08-02",
    venue: "코엑스(COEX)",
    address: "서울 강남구 영동대로 513",
    lat: 37.512627,
    lng: 127.058678,
    image_url: null,
  };

  it("maps a valid row to a Festival with source=akei-trade-expo and primaryCategory=trade_expo", () => {
    const result = mapAkeiTradeExpoRow(baseRow, 37.512627, 127.058678);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("akei-trade-expo");
    expect(result?.primaryCategory).toBe("trade_expo");
    expect(result?.title).toBe("제424회 웨덱스 웨딩박람회");
    expect(result?.organizerName).toBe("㈜웨덱스웨딩");
    expect(result?.distanceMeters).toBe(0);
  });

  it("returns null when the row has no id", () => {
    expect(mapAkeiTradeExpoRow({ ...baseRow, id: "" }, 37.5, 127.0)).toBeNull();
  });

  it("returns null when lat/lng are not finite numbers", () => {
    expect(mapAkeiTradeExpoRow({ ...baseRow, lat: NaN }, 37.5, 127.0)).toBeNull();
  });
});
