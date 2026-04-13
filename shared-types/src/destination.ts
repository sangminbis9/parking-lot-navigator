export interface DestinationCandidate {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: "mock" | "kakao-local";
}

export interface DestinationSearchResponse {
  items: DestinationCandidate[];
}
