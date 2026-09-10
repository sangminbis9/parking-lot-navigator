export type ParkingSource =
  | "mock"
  | "seoul-realtime"
  | "seoul-metadata"
  | "seoul-seongdong-iot"
  | "seoul-hangang-parking"
  | "daejeon-realtime"
  | "suseong-realtime"
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
  /**
   * 좌표가 원본 제공값이 아니라 주소 지오코딩으로 채운 근사치일 때 true.
   * 지번 주소 중심점이라 원본과 수십~수백 m 어긋나므로, 캐시가 이미 가진
   * 정확 좌표를 이 값으로 덮어쓰지 않게 하는 데 쓴다.
   */
  coordinateIsApproximate?: boolean;
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
