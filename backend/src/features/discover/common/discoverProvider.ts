import type { Festival, FreeEvent, ProviderHealth } from "@parking/shared-types";

export interface DiscoverQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  ongoingOnly?: boolean;
  upcomingWithinDays: number;
  freeOnly?: boolean;
}

export interface FestivalProvider {
  festivals(query: DiscoverQuery): Promise<Festival[]>;
  health(): ProviderHealth;
}

export interface EventProvider {
  events(query: DiscoverQuery): Promise<FreeEvent[]>;
  health(): ProviderHealth;
}
