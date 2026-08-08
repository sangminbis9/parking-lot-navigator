import { describe, expect, it } from "vitest";
import {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
  DISCOVERY_PROVIDER_CHUNKS,
} from "../src/discoverySchedule.js";
import { AkeiTradeExpoFestivalProvider } from "../src/akeiTradeExpoProvider.js";

describe("currentDiscoveryChunkIndex", () => {
  it("visits every discovery provider chunk within a 24 hour window", () => {
    const seen = new Set<number>();
    const cronMinutes = [0, 9, 18, 27, 36, 45, 54];

    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of cronMinutes) {
        seen.add(
          currentDiscoveryChunkIndex(
            new Date(Date.UTC(2026, 4, 24, hour, minute)),
          ),
        );
      }
    }

    expect(seen.size).toBe(DISCOVERY_PROVIDER_CHUNK_COUNT);
    for (let index = 0; index < DISCOVERY_PROVIDER_CHUNK_COUNT; index += 1) {
      expect(seen.has(index)).toBe(true);
    }
  });
});

describe("AKEI trade expo provider name consistency", () => {
  it("keeps the akei-trade-expo entry in DISCOVERY_PROVIDER_CHUNKS in sync with the provider's health().name", () => {
    const fakeDb = {} as unknown as D1Database;
    const providerName = new AkeiTradeExpoFestivalProvider(fakeDb).health().name;
    const chunkedProviderNames = DISCOVERY_PROVIDER_CHUNKS.flatMap(
      (chunk) => chunk.providers,
    );

    expect(chunkedProviderNames).toContain(providerName);
  });
});
