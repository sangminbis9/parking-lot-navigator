export type DiscoverStatus = "ongoing" | "upcoming";
export type EventCategory = "festival" | "performance" | "exhibition" | "culture" | "local_event" | "other";

export interface Festival {
  id: string;
  title: string;
  subtitle: string | null;
  startDate: string;
  endDate: string;
  status: DiscoverStatus;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  source: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  tags: string[];
}

export interface FreeEvent {
  id: string;
  title: string;
  eventType: string;
  category?: EventCategory;
  sourceId?: string;
  startDate: string;
  endDate: string;
  status: DiscoverStatus;
  isFree: boolean;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  source: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  shortDescription: string | null;
  price?: string | null;
  region?: string | null;
  updatedAt?: string;
}

export interface DiscoverFestivalsResponse {
  items: Festival[];
  generatedAt: string;
}

export interface DiscoverEventsResponse {
  items: FreeEvent[];
  generatedAt: string;
}
