import type { ParkingLot } from "./parking.js";
import type { DestinationCandidate } from "./destination.js";

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
