export type PlaceCategory =
  | "restaurant"
  | "cafe"
  | "tourist_spot"
  | "shopping"
  | "hospital"
  | "office"
  | "market"
  | "station"
  | "hotel"
  | "school"
  | "other";

export interface SearchHistoryRecord {
  id: string;
  deviceId: string;
  userId?: string | null;
  queryText: string;
  destinationId?: string | null;
  destinationName: string;
  address: string;
  lat: number;
  lng: number;
  selectedAt: string;
  normalizedCategory: PlaceCategory;
  rawCategory?: string | null;
  provider?: string | null;
}

export interface CreateSearchHistoryRequest {
  deviceId: string;
  userId?: string | null;
  queryText: string;
  destinationId?: string | null;
  destinationName: string;
  address: string;
  lat: number;
  lng: number;
  selectedAt?: string;
  normalizedCategory?: PlaceCategory;
  rawCategory?: string | null;
  provider?: string | null;
}

export interface SearchHistoryResponse {
  items: SearchHistoryRecord[];
  generatedAt: string;
}

export interface SearchHistoryStatsResponse {
  topCategories: Array<{
    category: PlaceCategory;
    count: number;
  }>;
  repeatedDestinations: Array<{
    destinationId?: string | null;
    destinationName: string;
    address: string;
    lat: number;
    lng: number;
    count: number;
    lastSelectedAt: string;
  }>;
  generatedAt: string;
}
