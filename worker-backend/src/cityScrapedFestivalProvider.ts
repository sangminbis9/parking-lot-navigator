import type { Festival } from "@parking/shared-types";
import { BaseProviderHealth } from "../../backend/src/providers/BaseProviderHealth.js";
import type { DiscoverQuery, FestivalProvider } from "../../backend/src/features/discover/common/discoverProvider.js";
import { queryCityFestivalsFromCache } from "./cityFestivalCache.js";

export class CityScrapedFestivalProvider extends BaseProviderHealth implements FestivalProvider {
  constructor(private readonly db: D1Database) {
    super("city-scraped");
  }

  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    try {
      const items = await queryCityFestivalsFromCache(
        this.db,
        query.lat,
        query.lng,
        query.radiusMeters,
        query.upcomingWithinDays
      );
      this.markSuccess(items.length > 0 ? 0.8 : 0.6);
      return items;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}
