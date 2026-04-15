import type { Festival, ProviderHealth } from "@parking/shared-types";
import { MemoryCache } from "../../../cache/memoryCache.js";
import { config } from "../../../config/env.js";
import type { DiscoverQuery, FestivalProvider } from "../common/discoverProvider.js";
import { MockFestivalProvider } from "./MockFestivalProvider.js";
import { TourApiFestivalProvider } from "./TourApiFestivalProvider.js";

const cache = new MemoryCache<Festival[]>();

export class FestivalService {
  constructor(private readonly providers: FestivalProvider[]) {}

  async nearby(query: DiscoverQuery): Promise<Festival[]> {
    const cacheKey = JSON.stringify({ type: "festivals", query });
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const results = await Promise.all(this.providers.map((provider) => provider.festivals(query)));
    const items = results.flat();
    cache.set(cacheKey, items, config.DISCOVER_CACHE_TTL_SECONDS);
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
    providers.push(new TourApiFestivalProvider(config.PUBLIC_DATA_SERVICE_KEY, config.PUBLIC_DATA_BASE_URL));
  }
  if (providers.length === 0 && config.PARKING_PROVIDER_MODE === "mock") {
    providers.push(new MockFestivalProvider());
  }
  return new FestivalService(providers);
}
