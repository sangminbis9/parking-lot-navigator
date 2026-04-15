import type { PlaceCategory } from "./analytics.js";

export interface DestinationCandidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: "mock" | "kakao-local";
  rawCategory?: string | null;
  normalizedCategory?: PlaceCategory;
}

export interface DestinationSearchResponse {
  items: DestinationCandidate[];
}
