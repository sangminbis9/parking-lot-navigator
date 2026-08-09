import { describe, expect, it } from "vitest";
import {
  CITY_FESTIVAL_CHUNK_SIZE,
  currentCityFestivalChunkIndex,
  sitesForChunk,
} from "../src/cityFestivalSchedule.js";
import { CITY_FESTIVAL_SITES } from "../src/cityFestivalSites.js";

describe("currentCityFestivalChunkIndex", () => {
  it("visits every chunk across enough days when site count exceeds one chunk", () => {
    const siteCount = 20; // chunkCount = ceil(20/CITY_FESTIVAL_CHUNK_SIZE) = 2
    const seen = new Set<number>();
    for (let day = 0; day < 10; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day, 4, 0));
      seen.add(currentCityFestivalChunkIndex(date, siteCount));
    }
    expect(seen).toEqual(new Set([0, 1]));
  });

  it("always returns 0 when site count fits in a single chunk", () => {
    for (let day = 0; day < 5; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day, 4, 0));
      expect(currentCityFestivalChunkIndex(date, 5)).toBe(0);
    }
  });

  it("returns 0 when site count is zero instead of dividing by zero", () => {
    expect(currentCityFestivalChunkIndex(new Date(Date.UTC(2026, 0, 1)), 0)).toBe(0);
  });

  it("rotates by whole days, not by time of day", () => {
    const early = new Date(Date.UTC(2026, 0, 1, 0, 0));
    const late = new Date(Date.UTC(2026, 0, 1, 23, 59));
    expect(currentCityFestivalChunkIndex(early, 20)).toBe(
      currentCityFestivalChunkIndex(late, 20),
    );
  });
});

describe("sitesForChunk", () => {
  it("slices the array into the requested chunk", () => {
    const sites = Array.from({ length: 20 }, (_, i) => `site-${i}`);
    expect(sitesForChunk(sites, 0, CITY_FESTIVAL_CHUNK_SIZE)).toEqual(
      sites.slice(0, CITY_FESTIVAL_CHUNK_SIZE),
    );
    expect(sitesForChunk(sites, 1, CITY_FESTIVAL_CHUNK_SIZE)).toEqual(
      sites.slice(CITY_FESTIVAL_CHUNK_SIZE, 20),
    );
  });

  it("returns an empty array for a chunk index beyond the array length", () => {
    const sites = ["a", "b", "c"];
    expect(sitesForChunk(sites, 5, 15)).toEqual([]);
  });
});

describe("CITY_FESTIVAL_SITES chunking (real array)", () => {
  it("covers every registered site exactly once across all chunks", () => {
    const chunkCount = Math.max(1, Math.ceil(CITY_FESTIVAL_SITES.length / CITY_FESTIVAL_CHUNK_SIZE));
    const seenSiteIds: string[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunk = sitesForChunk(CITY_FESTIVAL_SITES, chunkIndex, CITY_FESTIVAL_CHUNK_SIZE);
      for (const site of chunk) seenSiteIds.push(site.siteId);
    }
    expect(new Set(seenSiteIds).size).toBe(seenSiteIds.length);
    expect(seenSiteIds.sort()).toEqual(CITY_FESTIVAL_SITES.map((s) => s.siteId).sort());
  });
});
