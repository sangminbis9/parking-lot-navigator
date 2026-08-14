import { describe, expect, it } from "vitest";
import { isDetailFetchWorthwhile } from "../src/cityFestivalParsers/types.js";
import type { RawCityFestivalCandidate } from "../src/cityFestivalParsers/types.js";

function candidate(overrides: Partial<RawCityFestivalCandidate>): RawCityFestivalCandidate {
  return {
    title: "축제",
    startDateRaw: null,
    endDateRaw: null,
    venueRaw: null,
    addressRaw: null,
    detailUrl: "https://example.com/detail/1",
    imageUrl: null,
    ...overrides
  };
}

const now = new Date("2026-08-14T00:00:00Z");

describe("isDetailFetchWorthwhile", () => {
  it("skips a festival that already ended", () => {
    expect(isDetailFetchWorthwhile(candidate({ endDateRaw: "2026-08-13" }), now)).toBe(false);
    expect(
      isDetailFetchWorthwhile(candidate({ startDateRaw: "2026.07.01 ~ 2026.07.05" }), now)
    ).toBe(false);
  });

  it("keeps ongoing and upcoming festivals", () => {
    expect(isDetailFetchWorthwhile(candidate({ endDateRaw: "2026-08-14" }), now)).toBe(true);
    expect(
      isDetailFetchWorthwhile(candidate({ startDateRaw: "2026.08.01 ~ 2026.08.20" }), now)
    ).toBe(true);
  });

  it("keeps candidates whose dates cannot be parsed", () => {
    expect(isDetailFetchWorthwhile(candidate({ endDateRaw: "상시 운영" }), now)).toBe(true);
    expect(isDetailFetchWorthwhile(candidate({}), now)).toBe(true);
  });
});
