import { describe, expect, it } from "vitest";
import { resolveExhibitionVenue } from "../src/exhibitionVenues.js";

describe("resolveExhibitionVenue", () => {
  it("matches an exact Korean venue name", () => {
    const venue = resolveExhibitionVenue("코엑스");
    expect(venue).not.toBeNull();
    expect(venue?.lat).toBeCloseTo(37.512627, 3);
    expect(venue?.lng).toBeCloseTo(127.058678, 3);
  });

  it("matches an exact English alias", () => {
    const venue = resolveExhibitionVenue("COEX");
    expect(venue).not.toBeNull();
    expect(venue?.address).toBe("서울 강남구 영동대로 513");
  });

  it("matches by substring when the raw text has a parenthetical qualifier", () => {
    const venue = resolveExhibitionVenue("코엑스(COEX)");
    expect(venue).not.toBeNull();
    expect(venue?.lat).toBeCloseTo(37.512627, 3);
  });

  it("matches 코엑스 마곡 to its own Magok coordinates, not the Samseong-dong 코엑스 substring match", () => {
    const venue = resolveExhibitionVenue("코엑스 마곡 (COEX Magok)");
    expect(venue).not.toBeNull();
    expect(venue?.lat).toBeCloseTo(37.5601, 3);
    expect(venue?.lng).toBeCloseTo(126.83, 3);
  });

  it("still matches plain 코엑스 to its original Samseong-dong coordinates (guards the length-sort change)", () => {
    const venue = resolveExhibitionVenue("코엑스");
    expect(venue).not.toBeNull();
    expect(venue?.lat).toBeCloseTo(37.512627, 3);
    expect(venue?.lng).toBeCloseTo(127.058678, 3);
  });

  it("matches a real AKEI venue text with an English suffix", () => {
    const venue = resolveExhibitionVenue("송도컨벤시아(Songdo ConvensiA)");
    expect(venue).not.toBeNull();
    expect(venue?.address).toBe("인천 연수구 센트럴로 123");
  });

  it("matches a newly added domestic convention center with an English abbreviation suffix", () => {
    const venue = resolveExhibitionVenue("수원메쎄 (SUWON MESSE)");
    expect(venue).not.toBeNull();
    expect(venue?.address).toBe("경기 수원시 권선구 세화로134번길 37");
  });

  it("matches the English-only aT Center alias", () => {
    const venue = resolveExhibitionVenue("aT Center(at Center)");
    expect(venue).not.toBeNull();
    expect(venue?.address).toBe("서울 서초구 강남대로 27");
  });

  it("returns null for an unmapped venue name", () => {
    expect(resolveExhibitionVenue("듣도보도못한전시장")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveExhibitionVenue("   ")).toBeNull();
  });
});
