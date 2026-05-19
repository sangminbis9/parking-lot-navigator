import type { FreeEvent, ProviderHealth } from "@parking/shared-types";
import { MemoryCache } from "../../../cache/memoryCache.js";
import { config } from "../../../config/env.js";
import type {
  DiscoverQuery,
  EventProvider,
} from "../common/discoverProvider.js";
import {
  createCulturePortalResolver,
  CulturePortalEventProvider,
} from "./CulturePortalEventProvider.js";
import { dedupeCachedEvents } from "./eventProviderUtils.js";
import { KcisaCultureEventProvider } from "./KcisaCultureEventProvider.js";
import { KopisEventProvider } from "./KopisEventProvider.js";
import { MockEventProvider } from "./MockEventProvider.js";
import { SeoulCultureEventProvider } from "./SeoulCultureEventProvider.js";

const cache = new MemoryCache<FreeEvent[]>();

export class EventService {
  constructor(private readonly providers: EventProvider[]) {}

  async nearby(query: DiscoverQuery): Promise<FreeEvent[]> {
    const allowlist = query.providerAllowlist;
    const activeProviders = allowlist
      ? this.providers.filter((provider) =>
          allowlist.has(provider.health().name),
        )
      : this.providers;
    if (activeProviders.length === 0) return [];
    const cacheKey = JSON.stringify({
      type: "events",
      query: {
        ...query,
        providerAllowlist: allowlist ? [...allowlist].sort() : undefined,
      },
    });
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const results = await Promise.all(
      activeProviders.map((provider) => provider.events(query)),
    );
    const items = dedupeEvents(results.flat());
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

export function createEventService(): EventService {
  if (config.NODE_ENV === "test") {
    return new EventService([new MockEventProvider()]);
  }
  if (!config.EVENT_PROVIDER_ENABLED) {
    return new EventService([]);
  }
  const providers: EventProvider[] = [];
  if (config.SEOUL_OPEN_DATA_KEY) {
    providers.push(
      new SeoulCultureEventProvider(
        config.SEOUL_OPEN_DATA_KEY,
        config.SEOUL_OPEN_DATA_BASE_URL,
      ),
    );
  }
  const resolver = createCulturePortalResolver(config);
  const culturePortalKey =
    config.CULTURE_PORTAL_API_KEY ?? config.PUBLIC_DATA_SERVICE_KEY;
  if (culturePortalKey) {
    providers.push(
      new CulturePortalEventProvider(
        culturePortalKey,
        config.PUBLIC_DATA_BASE_URL,
        resolver,
      ),
    );
  }
  if (config.KOPIS_API_KEY) {
    providers.push(
      new KopisEventProvider(
        config.KOPIS_API_KEY,
        config.KOPIS_BASE_URL,
        resolver,
      ),
    );
  }
  if (config.KCISA_428_API_KEY) {
    providers.push(
      new KcisaCultureEventProvider({
        source: "kcisa_428",
        serviceKey: config.KCISA_428_API_KEY,
        baseUrl: config.KCISA_BASE_URL,
        path: "/openapi/service/rest/meta16/getkopis07",
        defaultCategoryText: "performance",
        resolver,
      }),
    );
  }
  if (config.KCISA_196_API_KEY) {
    providers.push(
      new KcisaCultureEventProvider({
        source: "kcisa_196",
        serviceKey: config.KCISA_196_API_KEY,
        baseUrl: config.KCISA_BASE_URL,
        path: "/openapi/service/rest/meta4/getKCPG0504",
        defaultCategoryText: "culture",
        resolver,
      }),
    );
  }
  if (providers.length === 0 && config.PARKING_PROVIDER_MODE === "mock") {
    providers.push(new MockEventProvider());
  }
  return new EventService(providers);
}

function dedupeEvents(items: FreeEvent[]): FreeEvent[] {
  const selected = dedupeCachedEvents(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      eventType: item.eventType,
      category: item.category ?? "other",
      sourceId: item.sourceId ?? item.id,
      startDate: item.startDate,
      endDate: item.endDate,
      isFree: item.isFree,
      venueName: item.venueName,
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      source: item.source,
      sourceUrl: item.sourceUrl,
      imageUrl: item.imageUrl,
      shortDescription: item.shortDescription,
      price: item.price ?? null,
      region: item.region ?? null,
      updatedAt: item.updatedAt ?? new Date().toISOString(),
    })),
  );
  return selected.map((item) => ({
    ...item,
    status:
      items.find((candidate) => candidate.id === item.id)?.status ?? "upcoming",
    distanceMeters:
      items.find((candidate) => candidate.id === item.id)?.distanceMeters ?? 0,
  }));
}
