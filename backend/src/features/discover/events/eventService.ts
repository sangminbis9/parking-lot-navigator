import type { FreeEvent, ProviderHealth } from "@parking/shared-types";
import { MemoryCache } from "../../../cache/memoryCache.js";
import { config } from "../../../config/env.js";
import type { DiscoverQuery, EventProvider } from "../common/discoverProvider.js";
import { MockEventProvider } from "./MockEventProvider.js";
import { SeoulCultureEventProvider } from "./SeoulCultureEventProvider.js";

const cache = new MemoryCache<FreeEvent[]>();

export class EventService {
  constructor(private readonly providers: EventProvider[]) {}

  async nearby(query: DiscoverQuery): Promise<FreeEvent[]> {
    const cacheKey = JSON.stringify({ type: "events", query });
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const results = await Promise.all(this.providers.map((provider) => provider.events(query)));
    const items = results.flat();
    if (items.length > 0 || this.health().some((provider) => provider.status !== "down")) {
      cache.set(cacheKey, items, config.DISCOVER_CACHE_TTL_SECONDS);
    }
    return items;
  }

  health(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }
}

export function createEventService(): EventService {
  if (config.NODE_ENV === "test") {
    return new EventService([new MockEventProvider()]);
  }
  if (!config.EVENT_PROVIDER_ENABLED) {
    return new EventService([]);
  }
  const providers: EventProvider[] = [];
  if (config.SEOUL_OPEN_DATA_KEY) {
    providers.push(new SeoulCultureEventProvider(config.SEOUL_OPEN_DATA_KEY, config.SEOUL_OPEN_DATA_BASE_URL));
  }
  if (providers.length === 0 && config.PARKING_PROVIDER_MODE === "mock") {
    providers.push(new MockEventProvider());
  }
  return new EventService(providers);
}
