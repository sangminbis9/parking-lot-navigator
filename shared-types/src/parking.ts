export type ParkingSource =
  | "mock"
  | "seoul-realtime"
  | "seoul-metadata"
  | "daejeon-realtime"
  | "kac-airport-realtime"
  | "incheon-airport-realtime"
  | "national-static"
  | "ts-korea"
  | "kakao-local";

export type CongestionStatus = "available" | "moderate" | "busy" | "full" | "unknown";

export interface ParkingProvenance {
  source: ParkingSource;
  sourceParkingId: string;
  freshnessTimestamp?: string | null;
}

export interface ParkingLot {
  id: string;
  source: ParkingSource;
  sourceParkingId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceFromDestinationMeters: number;
  totalCapacity: number | null;
  availableSpaces: number | null;
  occupancyRate: number | null;
  congestionStatus: CongestionStatus;
  realtimeAvailable: boolean;
  freshnessTimestamp: string | null;
  operatingHours: string | null;
  feeSummary: string | null;
  supportsEv: boolean;
  supportsAccessible: boolean;
  isPublic: boolean;
  isPrivate: boolean;
  stale: boolean;
  displayStatus: string;
  score: number;
  provenance: ParkingProvenance[];
  rawSourcePayload?: unknown;
}

export interface ParkingSearchOptions {
  radiusMeters: number;
  preferPublic?: boolean;
  evOnly?: boolean;
  accessibleOnly?: boolean;
  bestWalkingDistanceBias?: boolean;
}
