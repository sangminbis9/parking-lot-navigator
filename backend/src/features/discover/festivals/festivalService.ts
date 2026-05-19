import type {
  Festival,
  FreeEvent,
  ProviderHealth,
} from "@parking/shared-types";
import { MemoryCache } from "../../../cache/memoryCache.js";
import { config } from "../../../config/env.js";
import type {
  DiscoverQuery,
  FestivalProvider,
} from "../common/discoverProvider.js";
import { MockFestivalProvider } from "./MockFestivalProvider.js";
import { NationalCultureFestivalProvider } from "./NationalCultureFestivalProvider.js";
import { TourApiFestivalProvider } from "./TourApiFestivalProvider.js";
import {
  createEventService,
  type EventService,
} from "../events/eventService.js";

const cache = new MemoryCache<Festival[]>();

export class FestivalService {
  constructor(
    private readonly providers: FestivalProvider[],
    private readonly legacyEventService?: EventService,
  ) {}

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

    const [festivalResults, legacyEvents] = await Promise.all([
      Promise.all(activeProviders.map((provider) => provider.festivals(query))),
      this.legacyEventService
        ? this.legacyEventService.nearby(query)
        : Promise.resolve([]),
    ]);
    const items = dedupeFestivals([
      ...festivalResults.flat(),
      ...legacyEvents.map(legacyEventToFestival),
    ]);
    if (
      items.length > 0 ||
      this.health().some((provider) => provider.status !== "down")
    ) {
      cache.set(cacheKey, items, config.DISCOVER_CACHE_TTL_SECONDS);
    }
    return items;
  }

  health(): ProviderHealth[] {
    return [
      ...this.providers.map((provider) => provider.health()),
      ...(this.legacyEventService?.health() ?? []),
    ];
  }
}

export function createFestivalService(): FestivalService {
  if (config.NODE_ENV === "test") {
    return new FestivalService(
      [new MockFestivalProvider()],
      createEventService(),
    );
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
  }
  if (providers.length === 0 && config.PARKING_PROVIDER_MODE === "mock") {
    providers.push(new MockFestivalProvider());
  }
  return new FestivalService(providers, createEventService());
}

function legacyEventToFestival(item: FreeEvent): Festival {
  return {
    id: `public-event-${item.id}`,
    title: item.title,
    subtitle: item.shortDescription ?? item.eventType,
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    venueName: item.venueName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    distanceMeters: item.distanceMeters,
    source: item.source,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    tags: ["public-culture", item.eventType, item.category ?? "culture"].filter(
      (tag): tag is string => Boolean(tag),
    ),
  };
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
