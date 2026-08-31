import type { ParkingLot, ParkingSearchOptions, ProviderHealth } from "@parking/shared-types";

export interface RawParkingRecord {
  source: ParkingLot["source"];
  sourceParkingId: string;
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** 원본에 좌표가 없어 주소 지오코딩으로 채운 근사 좌표. 원본 좌표가 있으면 그쪽이 이긴다. */
  coordinateIsApproximate?: boolean;
  totalCapacity?: number | null;
  availableSpaces?: number | null;
  congestionStatus?: ParkingLot["congestionStatus"] | null;
  realtimeAvailable?: boolean;
  freshnessTimestamp?: string | null;
  operatingHours?: string | null;
  feeSummary?: string | null;
  supportsEv?: boolean;
  supportsAccessible?: boolean;
  isPublic?: boolean;
  isPrivate?: boolean;
  rawSourcePayload?: unknown;
}

export interface ParkingProvider {
  readonly name: string;
  fetchNearby(lat: number, lng: number, options: ParkingSearchOptions): Promise<RawParkingRecord[]>;
  health(): ProviderHealth;
}
