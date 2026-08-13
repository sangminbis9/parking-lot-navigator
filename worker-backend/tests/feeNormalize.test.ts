import { describe, expect, it } from "vitest";
import { discoveryRow } from "../src/discoveryCache.js";
import { feeFreeFlag, normalizeFee } from "../src/feeNormalize.js";
import type { Festival, FreeEvent } from "@parking/shared-types";

describe("normalizeFee", () => {
  it("treats an amount as paid even when a partial free notice follows", () => {
    expect(normalizeFee("전석 20,000원")).toEqual({
      feeType: "paid",
      feeText: "전석 20,000원",
    });
    expect(normalizeFee("성인 5,000원 / 어린이 무료").feeType).toBe("paid");
  });

  it("reads explicit free wording as free", () => {
    expect(normalizeFee("무료").feeType).toBe("free");
    expect(normalizeFee("입장료 없음").feeType).toBe("free");
    expect(normalizeFee("Free admission").feeType).toBe("free");
    // "0원"은 금액이 아니라 무료 표기다.
    expect(normalizeFee("입장료 0원").feeType).toBe("free");
  });

  it("does not call a fee free when only a specific group is exempt", () => {
    expect(normalizeFee("65세 이상 무료").feeType).toBe("unknown");
    expect(normalizeFee("장애인 무료").feeType).toBe("unknown");
  });

  it("marks wording that says paid without an amount as paid", () => {
    expect(normalizeFee("유료").feeType).toBe("paid");
    expect(normalizeFee("사전 예매 필수").feeType).toBe("paid");
  });

  it("returns unknown for missing or content-free text", () => {
    expect(normalizeFee(null)).toEqual({ feeType: "unknown", feeText: null });
    expect(normalizeFee("   ")).toEqual({ feeType: "unknown", feeText: null });
    expect(normalizeFee("현장 문의")).toEqual({
      feeType: "unknown",
      feeText: "현장 문의",
    });
  });

  it("strips markup and collapses whitespace", () => {
    expect(normalizeFee("<p>성인&nbsp;5,000원<br />청소년 3,000원</p>").feeText).toBe(
      "성인 5,000원 청소년 3,000원",
    );
  });

  it("caps very long text so one row cannot bloat the response", () => {
    const result = normalizeFee("가".repeat(400));
    expect(result.feeText).toHaveLength(301);
    expect(result.feeText?.endsWith("…")).toBe(true);
  });
});

describe("feeFreeFlag", () => {
  it("leaves undecidable fees NULL instead of folding them into 유료", () => {
    expect(feeFreeFlag(normalizeFee("무료"))).toBe(1);
    expect(feeFreeFlag(normalizeFee("10,000원"))).toBe(0);
    expect(feeFreeFlag(normalizeFee("현장 문의"))).toBeNull();
  });
});

const festival: Festival = {
  id: "tour:2739661",
  title: "테스트 축제",
  subtitle: null,
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  status: "upcoming",
  venueName: "코엑스",
  address: "서울 강남구 영동대로 513",
  lat: 37.512627,
  lng: 127.058678,
  distanceMeters: 0,
  source: "tourapi",
  sourceUrl: null,
  imageUrl: null,
  tags: [],
};

const event: FreeEvent = {
  id: "kopis:PF123456",
  eventType: "performance",
  title: "테스트 공연",
  description: null,
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  venueName: "예술의전당",
  address: "서울 서초구 남부순환로 2406",
  lat: 37.4794,
  lng: 127.0113,
  distanceMeters: 0,
  isFree: false,
  source: "kopis",
  sourceUrl: null,
  imageUrl: null,
  tags: [],
};

describe("discoveryRow fee columns", () => {
  it("writes a festival admissionFee into lowest_price_text and is_free", () => {
    const paid = discoveryRow(
      { ...festival, admissionFee: "성인 5,000원" },
      "2026-08-14T00:00:00.000Z",
    );
    expect(paid.lowestPriceText).toBe("성인 5,000원");
    expect(paid.isFree).toBe(0);

    const free = discoveryRow(
      { ...festival, admissionFee: "무료" },
      "2026-08-14T00:00:00.000Z",
    );
    expect(free.isFree).toBe(1);

    const unknown = discoveryRow(festival, "2026-08-14T00:00:00.000Z");
    expect(unknown.lowestPriceText).toBeNull();
    expect(unknown.isFree).toBeNull();
  });

  it("writes an event price into the same two columns", () => {
    const row = discoveryRow(
      { ...event, price: "전석 20,000원" },
      "2026-08-14T00:00:00.000Z",
    );
    expect(row.lowestPriceText).toBe("전석 20,000원");
    expect(row.isFree).toBe(0);
  });

  it("keeps an event flagged free when its price text says so", () => {
    const row = discoveryRow(
      { ...event, price: "무료" },
      "2026-08-14T00:00:00.000Z",
    );
    expect(row.isFree).toBe(1);
  });
});
