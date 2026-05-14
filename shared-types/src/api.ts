import type { ParkingLot } from "./parking.js";
import type { DestinationCandidate } from "./destination.js";
import type { Festival, FreeEvent, LocalEvent, MapItem } from "./discover.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export interface ParkingNearbyResponse {
  destination: {
    lat: number;
    lng: number;
    radiusMeters: number;
  };
  items: ParkingLot[];
  generatedAt: string;
}

export interface ProviderHealth {
  name: string;
  status: "up" | "degraded" | "down";
  lastSuccessAt: string | null;
  lastError: string | null;
  qualityScore: number;
  stale: boolean;
}

export interface ProviderHealthResponse {
  providers: ProviderHealth[];
  generatedAt: string;
}

export interface DestinationSearchApiResponse {
  items: DestinationCandidate[];
}

export interface DiscoverFestivalsApiResponse {
  items: Festival[];
  generatedAt: string;
}

export interface DiscoverEventsApiResponse {
  items: FreeEvent[];
  generatedAt: string;
}

export interface LocalEventsApiResponse {
  items: LocalEvent[];
  generatedAt: string;
  nextCursor?: string | null;
}

export interface LocalEventApiResponse {
  item: LocalEvent;
  generatedAt: string;
}

export interface MapItemsApiResponse {
  items: MapItem[];
  generatedAt: string;
  nextCursor?: string | null;
}
