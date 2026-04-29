import type { Festival, FreeEvent, LodgingOption, ProviderHealth } from "@parking/shared-types";

export interface DiscoverQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  ongoingOnly?: boolean;
  upcomingWithinDays: number;
  freeOnly?: boolean;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  rooms?: number;
}

export interface FestivalProvider {
  festivals(query: DiscoverQuery): Promise<Festival[]>;
  health(): ProviderHealth;
}

export interface EventProvider {
  events(query: DiscoverQuery): Promise<FreeEvent[]>;
  health(): ProviderHealth;
}

export interface LodgingProvider {
  lodging(query: DiscoverQuery): Promise<LodgingOption[]>;
  health(): ProviderHealth;
}
