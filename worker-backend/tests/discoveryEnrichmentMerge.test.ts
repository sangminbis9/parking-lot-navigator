import { describe, expect, it } from "vitest";
import { mergeWithExistingEnrichment } from "../src/discoveryCache.js";
import type { Festival, FreeEvent } from "@parking/shared-types";

// backfill이 채운 요금·프로그램은 raw_payload를 통째로 덮어쓰는 다음 full sync에서
// 살아남아야 한다. 살아남지 못하면 그 조회에 쓴 subrequest가 통째로 낭비된다.
function dbWith(rows: Array<{ id: string; raw_payload: string | null; lowest_price_text: string | null }>): D1Database {
  return {
    prepare: () => ({
      bind: () => ({ all: async () => ({ results: rows }) })
    })
  } as unknown as D1Database;
}

const festival: Festival = {
  id: "1100492",
  title: "축제",
  subtitle: null,
  startDate: "2099-01-01",
  endDate: "2099-01-02",
  status: "upcoming",
  venueName: null,
  address: "서울 중구",
  lat: 37.5,
  lng: 127,
  distanceMeters: 0,
  source: "tourapi",
  sourceUrl: null,
  imageUrl: null,
  tags: []
};

const event: FreeEvent = {
  id: "PF12345",
  title: "공연",
  eventType: "performance",
  startDate: "2099-01-01",
  endDate: "2099-01-02",
  status: "upcoming",
  isFree: false,
  venueName: null,
  address: "서울 중구",
  lat: 37.5,
  lng: 127,
  distanceMeters: 0,
  source: "kopis",
  sourceUrl: null,
  imageUrl: null,
  shortDescription: null
};

describe("mergeWithExistingEnrichment", () => {
  it("keeps a backfilled fee and programInfo on a festival whose fresh sync payload has neither", async () => {
    const db = dbWith([
      {
        id: "festival:1100492",
        raw_payload: JSON.stringify({
          admissionFee: "성인 10,000원",
          programInfo: "공연시간: 10:00~18:00\n부대행사: 불꽃놀이"
        }),
        lowest_price_text: "성인 10,000원"
      }
    ]);

    const [merged] = (await mergeWithExistingEnrichment(db, [festival])) as Festival[];

    expect(merged.admissionFee).toBe("성인 10,000원");
    expect(merged.programInfo).toBe("공연시간: 10:00~18:00\n부대행사: 불꽃놀이");
  });

  it("keeps a backfilled fee and programInfo on an event whose fresh sync payload has neither", async () => {
    const db = dbWith([
      {
        id: "festival:kopis:PF12345",
        raw_payload: JSON.stringify({
          price: "전석 20,000원",
          programInfo: "공연시간: 토요일 15:00\n출연: 아이유"
        }),
        lowest_price_text: "전석 20,000원"
      }
    ]);

    const [merged] = (await mergeWithExistingEnrichment(db, [event])) as FreeEvent[];

    expect(merged.price).toBe("전석 20,000원");
    // 여러 줄로 저장된 출연진 정보가 줄바꿈까지 그대로 살아남아야 한다.
    expect(merged.programInfo).toBe("공연시간: 토요일 15:00\n출연: 아이유");
  });

  it("lets a fresh value win over the stored one", async () => {
    const db = dbWith([
      {
        id: "festival:kopis:PF12345",
        raw_payload: JSON.stringify({ price: "옛 요금", programInfo: "옛 프로그램" }),
        lowest_price_text: "옛 요금"
      }
    ]);

    const [merged] = (await mergeWithExistingEnrichment(db, [
      { ...event, price: "새 요금", programInfo: "새 프로그램" }
    ])) as FreeEvent[];

    expect(merged.price).toBe("새 요금");
    expect(merged.programInfo).toBe("새 프로그램");
  });
});
