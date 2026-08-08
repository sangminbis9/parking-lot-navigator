import { describe, expect, it } from "vitest";
import { discoveryRow, prepareDiscoveryUpsert } from "../src/discoveryCache.js";
import type { Festival } from "@parking/shared-types";

const baseFestival: Festival = {
  id: "akei:104910",
  title: "제424회 웨덱스 웨딩박람회",
  subtitle: null,
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  status: "upcoming",
  venueName: "코엑스",
  address: "서울 강남구 영동대로 513",
  lat: 37.512627,
  lng: 127.058678,
  distanceMeters: 0,
  source: "akei-trade-expo",
  sourceUrl: "https://www.akei.or.kr/bbs/board.php?bo_table=schedule&wr_id=104910",
  imageUrl: null,
  tags: [],
  primaryCategory: "trade_expo",
};

describe("discoveryRow", () => {
  it("carries an in-memory primaryCategory through to the row payload with TAGGING_VERSION", () => {
    const row = discoveryRow(baseFestival, "2026-08-08T00:00:00.000Z");
    expect(row.primaryCategory).toBe("trade_expo");
    expect(row.taggingVersion).toBe(1);
  });

  it("defaults to null primaryCategory and tagging_version=0 when the item has none set", () => {
    const row = discoveryRow({ ...baseFestival, primaryCategory: undefined }, "2026-08-08T00:00:00.000Z");
    expect(row.primaryCategory).toBeNull();
    expect(row.taggingVersion).toBe(0);
  });
});

describe("prepareDiscoveryUpsert", () => {
  it("binds primaryCategory and taggingVersion as part of the upsert statement", () => {
    const bindCalls: unknown[][] = [];
    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          bindCalls.push(args);
          return {};
        },
      }),
    } as unknown as D1Database;

    prepareDiscoveryUpsert(db, baseFestival, "2026-08-08T00:00:00.000Z");

    expect(bindCalls).toHaveLength(1);
    expect(bindCalls[0]).toContain("trade_expo");
    expect(bindCalls[0]).toContain(1);
  });
});
