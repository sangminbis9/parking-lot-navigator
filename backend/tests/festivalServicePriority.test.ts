import type { Festival, ProviderHealth } from "@parking/shared-types";
import { describe, expect, it } from "vitest";
import { FestivalService, createFestivalService } from "../src/features/discover/festivals/festivalService.js";
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

  it("keeps keyword-tour over city-scraped when duplicate festivals arrive from both", async () => {
    const service = new FestivalService([
      providerForSource("city-scraped"),
      providerForSource("keyword-tour"),
    ]);

    const items = await service.nearby({
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12347,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("keyword-tour");
  });

  it("keeps area-based-tour over city-scraped when duplicate festivals arrive from both", async () => {
    const service = new FestivalService([
      providerForSource("city-scraped"),
      providerForSource("area-based-tour"),
    ]);

    const items = await service.nearby({
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12348,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("area-based-tour");
  });
});

describe("FestivalService empty-result caching", () => {
  it("does not cache an empty answer when the provider it called is down", async () => {
    let calls = 0;
    const down: FestivalProvider = {
      async festivals() {
        calls += 1;
        return [];
      },
      health(): ProviderHealth {
        return {
          name: "public-data-culture-festival",
          status: "down",
          lastSuccessAt: null,
          lastError: "boom",
          qualityScore: 0,
          stale: true
        };
      }
    };
    const service = new FestivalService([down, providerForSource("tourapi")]);
    const query: DiscoverQuery = {
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12349,
      upcomingWithinDays: 36500,
      providerAllowlist: new Set(["public-data-culture-festival"])
    };

    await service.nearby(query);
    await service.nearby(query);

    expect(calls).toBe(2);
  });
});

describe("createFestivalService extraProviders", () => {
  it("includes extra providers passed in, regardless of which provider-mode branch runs", async () => {
    const extra = providerForSource("city-scraped");
    const service = createFestivalService([extra]);
    const names = service.health().map((entry) => entry.name);
    expect(names).toContain("city-scraped");
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
