import type { Festival, ProviderHealth } from "@parking/shared-types";
import { describe, expect, it } from "vitest";
import { FestivalService } from "../src/features/discover/festivals/festivalService.js";
import type {
  DiscoverQuery,
  FestivalProvider,
} from "../src/features/discover/common/discoverProvider.js";

describe("FestivalService source priority", () => {
  it("keeps tourapi when duplicate festivals arrive from every source", async () => {
    const providers = [
      providerForSource("keyword-tour"),
      providerForSource("area-based-tour"),
      providerForSource("public-data-culture-festival"),
      providerForSource("tourapi"),
    ];
    const service = new FestivalService(providers);

    const items = await service.nearby({
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12346,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("tourapi");
  });

  it("uses strict ordering when tourapi is absent", async () => {
    const service = new FestivalService([
      providerForSource("keyword-tour"),
      providerForSource("public-data-culture-festival"),
      providerForSource("area-based-tour"),
    ]);

    const items = await service.nearby({
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12345,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("area-based-tour");
  });
});

function providerForSource(source: string): FestivalProvider {
  return {
    async festivals(_query: DiscoverQuery) {
      return [
        {
          id: `${source}:1`,
          title: "Priority Festival",
          subtitle: source,
          startDate: "2099-11-01",
          endDate: "2099-11-03",
          status: "upcoming",
          venueName: "Priority Plaza",
          address: "Priority Address",
          lat: 37.1,
          lng: 127.1,
          distanceMeters: 0,
          source,
          sourceUrl: null,
          imageUrl: null,
          tags: [source]
        } satisfies Festival
      ];
    },
    health(): ProviderHealth {
      return {
        name: source,
        status: "up",
        lastSuccessAt: "2099-01-01T00:00:00.000Z",
        lastError: null,
        qualityScore: 1,
        stale: false
      };
    }
  };
}
