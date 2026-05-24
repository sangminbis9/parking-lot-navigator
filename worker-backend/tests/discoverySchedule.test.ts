import { describe, expect, it } from "vitest";
import {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
} from "../src/discoverySchedule.js";

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
