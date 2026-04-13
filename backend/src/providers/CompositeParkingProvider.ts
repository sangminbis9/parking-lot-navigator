import type { ParkingLot, ParkingSearchOptions, ProviderHealth } from "@parking/shared-types";
import type { ParkingProvider } from "../types/provider.js";
import { config } from "../config/env.js";
import { normalizeParkingRecord } from "../normalization/normalizeParking.js";
import { deduplicateParkingLots } from "../deduplication/deduplicateParking.js";
import { rankParkingLots } from "../ranking/rankParking.js";

export class CompositeParkingProvider {
  constructor(private readonly providers: ParkingProvider[]) {}

  async nearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<ParkingLot[]> {
    const records = (
      await Promise.all(this.providers.map((provider) => provider.fetchNearby(lat, lng, options)))
    ).flat();
    const normalized = records.map((record) =>
      normalizeParkingRecord(record, lat, lng, config.STALE_THRESHOLD_SECONDS)
    );
    const deduped = deduplicateParkingLots(normalized);
    return rankParkingLots(deduped, options);
  }

  health(): ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }
}
