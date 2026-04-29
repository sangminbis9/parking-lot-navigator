import type { LodgingOption, ProviderHealth } from "@parking/shared-types";
import { MemoryCache } from "../../../cache/memoryCache.js";
import { config } from "../../../config/env.js";
import type { DiscoverQuery, LodgingProvider } from "../common/discoverProvider.js";
import { ExpediaTravelRedirectLodgingProvider } from "./ExpediaTravelRedirectLodgingProvider.js";
import { KakaoLodgingProvider } from "./KakaoLodgingProvider.js";
import { MockLodgingProvider } from "./MockLodgingProvider.js";
import { TourApiLodgingProvider } from "./TourApiLodgingProvider.js";

const cache = new MemoryCache<LodgingOption[]>();

export class LodgingService {
  constructor(private readonly providers: LodgingProvider[]) {}

  async nearby(query: DiscoverQuery): Promise<LodgingOption[]> {
    const cacheKey = JSON.stringify({ type: "lodging", query });
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const results = await Promise.all(this.providers.map((provider) => provider.lodging(query)));
    const items = dedupeLodging(results.flat()).sort((a, b) => a.distanceMeters - b.distanceMeters);
    if (items.length > 0 || this.health().some((provider) => provider.status !== "down")) {
      cache.set(cacheKey, items, config.DISCOVER_CACHE_TTL_SECONDS);
    }
    return items;
  }

  health(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }
}

export function createLodgingService(): LodgingService {
  if (config.NODE_ENV === "test") {
    return new LodgingService([new MockLodgingProvider()]);
  }
  if (!config.LODGING_PROVIDER_ENABLED) {
    return new LodgingService([]);
  }
  const providers: LodgingProvider[] = [];
  if (config.PUBLIC_DATA_SERVICE_KEY) {
    providers.push(new TourApiLodgingProvider(config.PUBLIC_DATA_SERVICE_KEY, config.PUBLIC_DATA_BASE_URL));
  }
  if (config.KAKAO_REST_API_KEY) {
    providers.push(new KakaoLodgingProvider(config));
  }
  if (
    config.EXPEDIA_TRAVEL_REDIRECT_API_KEY &&
    (config.EXPEDIA_TRAVEL_REDIRECT_PASSWORD || config.EXPEDIA_TRAVEL_REDIRECT_AUTHORIZATION)
  ) {
    providers.push(
      new ExpediaTravelRedirectLodgingProvider({
        apiKey: config.EXPEDIA_TRAVEL_REDIRECT_API_KEY,
        password: config.EXPEDIA_TRAVEL_REDIRECT_PASSWORD,
        authorization: config.EXPEDIA_TRAVEL_REDIRECT_AUTHORIZATION,
        baseUrl: config.EXPEDIA_TRAVEL_REDIRECT_BASE_URL,
        locale: config.EXPEDIA_TRAVEL_REDIRECT_LOCALE,
        currency: config.EXPEDIA_TRAVEL_REDIRECT_CURRENCY
      })
    );
  }
  return new LodgingService(providers);
}

function dedupeLodging(items: LodgingOption[]): LodgingOption[] {
  const selected: LodgingOption[] = [];
  for (const item of items) {
    const duplicateIndex = selected.findIndex((candidate) => isLikelySameLodging(candidate, item));
    if (duplicateIndex === -1) {
      selected.push(item);
      continue;
    }
    selected[duplicateIndex] = preferRicherLodging(selected[duplicateIndex], item);
  }
  return selected;
}

function isLikelySameLodging(a: LodgingOption, b: LodgingOption): boolean {
  const sameName = normalizeKey(a.name) === normalizeKey(b.name);
  const close = Math.abs(a.lat - b.lat) < 0.0008 && Math.abs(a.lng - b.lng) < 0.0008;
  const sameAddress = Boolean(a.address && b.address && normalizeKey(a.address) === normalizeKey(b.address));
  return (sameName && close) || (sameName && sameAddress);
}

function preferRicherLodging(a: LodgingOption, b: LodgingOption): LodgingOption {
  const aScore = richnessScore(a);
  const bScore = richnessScore(b);
  return bScore > aScore ? b : a;
}

function richnessScore(item: LodgingOption): number {
  return [
    item.imageUrl,
    item.sourceUrl,
    item.address,
    item.amenities.length > 0 ? "amenities" : null,
    item.offers.length > 0 ? "offers" : null
  ].filter(Boolean).length;
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}
