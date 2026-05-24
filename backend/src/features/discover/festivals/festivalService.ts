import type { Festival, ProviderHealth } from "@parking/shared-types";
import { MemoryCache } from "../../../cache/memoryCache.js";
import { config } from "../../../config/env.js";
import type {
  DiscoverQuery,
  FestivalProvider,
} from "../common/discoverProvider.js";
import { MockFestivalProvider } from "./MockFestivalProvider.js";
import { NationalCultureFestivalProvider } from "./NationalCultureFestivalProvider.js";
import { TourApiAreaFestivalProvider } from "./TourApiAreaFestivalProvider.js";
import { TourApiFestivalProvider } from "./TourApiFestivalProvider.js";
import { TourApiKeywordFestivalProvider } from "./TourApiKeywordFestivalProvider.js";

const cache = new MemoryCache<Festival[]>();

export class FestivalService {
  constructor(private readonly providers: FestivalProvider[]) {}

  async nearby(query: DiscoverQuery): Promise<Festival[]> {
    const allowlist = query.providerAllowlist;
    const activeProviders = allowlist
      ? this.providers.filter((provider) =>
          allowlist.has(provider.health().name),
        )
      : this.providers;
    const cacheKey = JSON.stringify({
      type: "festivals",
      query: {
        ...query,
        providerAllowlist: allowlist ? [...allowlist].sort() : undefined,
      },
    });
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const festivalResults = await Promise.all(
      activeProviders.map((provider) => provider.festivals(query)),
    );
    const items = dedupeFestivals(festivalResults.flat());
    if (
      items.length > 0 ||
      this.health().some((provider) => provider.status !== "down")
    ) {
      cache.set(cacheKey, items, config.DISCOVER_CACHE_TTL_SECONDS);
    }
    return items;
  }

  health(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }
}

export function createFestivalService(): FestivalService {
  if (config.NODE_ENV === "test") {
    return new FestivalService([new MockFestivalProvider()]);
  }
  if (!config.FESTIVAL_PROVIDER_ENABLED) {
    return new FestivalService([]);
  }
  const providers: FestivalProvider[] = [];
  if (config.PUBLIC_DATA_SERVICE_KEY) {
    providers.push(
      new TourApiFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
    providers.push(
      new NationalCultureFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
    providers.push(
      new TourApiAreaFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
    providers.push(
      new TourApiKeywordFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
  }
  if (providers.length === 0 && config.PARKING_PROVIDER_MODE === "mock") {
    providers.push(new MockFestivalProvider());
  }
  return new FestivalService(providers);
}

function dedupeFestivals(items: Festival[]): Festival[] {
  const selected = new Map<string, Festival>();
  for (const item of items) {
    const key = [
      normalizeTitle(item.title),
      item.startDate,
      item.endDate,
      Math.round(item.lat * 1000),
      Math.round(item.lng * 1000),
    ].join("|");
    const previous = selected.get(key);
    if (
      !previous ||
      sourcePriority(item.source) > sourcePriority(previous.source)
    ) {
      selected.set(key, item);
    }
  }
  return [...selected.values()];
}

function sourcePriority(source: string): number {
  if (source === "tourapi") return 3;
  if (source === "public-data-culture-festival") return 2;
  if (source === "area-based-tour") return 2;
  if (source === "keyword-tour") return 1;
  return 1;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d{4}/g, "")
    .replace(/\uC81C\s*\d+\s*\uD68C/g, "")
    .replace(/[()[\]{}"'`~!@#$%^&*_+=,./<>?:;|\\-]/g, "")
    .replace(/\s+/g, "");
}
