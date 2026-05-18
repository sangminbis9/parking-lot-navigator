export type DiscoverStatus = "ongoing" | "upcoming";
export type EventCategory =
  | "festival"
  | "performance"
  | "exhibition"
  | "culture"
  | "local_event"
  | "other";
export type LocalEventSource =
  | "instagram"
  | "naver_place"
  | "naver_blog"
  | "owner_submitted"
  | "admin_manual"
  | "user_report"
  | "official_site"
  | "other";
export type LocalEventStatus = "pending" | "approved" | "rejected" | "expired";
export type LocalEventType =
  | "discount"
  | "freebie"
  | "review_event"
  | "popup"
  | "limited_menu"
  | "opening_event"
  | "etc";
export type MapItemType = "parking" | "festival" | "event";

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

export interface LocalEvent {
  id: string;
  title: string;
  eventType: LocalEventType;
  category: "local_event";
  sourceId?: string;
  startDate: string;
  endDate: string | null;
  status: LocalEventStatus;
  storeName: string;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  source: LocalEventSource;
  sourceUrl: string | null;
  imageUrl: string | null;
  benefit: string | null;
  shortDescription: string | null;
  region?: string | null;
  updatedAt?: string;
  confidenceScore?: number | null;
  needsReview?: boolean;
  isSponsored: boolean;
  sponsorTier: string | null;
  paidUntil: string | null;
  priorityScore: number;
}

export interface LocalEventDraft {
  title?: string;
  description?: string;
  benefit?: string;
  startDate?: string;
  endDate?: string | null;
  storeName?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  source: LocalEventSource;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  eventType?: LocalEventType;
}

export interface LocalEventReportRequest {
  sourceUrl?: string | null;
  captionText?: string | null;
  storeName?: string | null;
  address?: string | null;
  imageUrl?: string | null;
  note?: string | null;
}

export interface LocalEventAdminUpsertRequest extends LocalEventDraft {
  status?: LocalEventStatus;
  isSponsored?: boolean;
  sponsorTier?: string | null;
  paidUntil?: string | null;
  priorityScore?: number;
}

export interface LocalEventStatusPatchRequest {
  status: LocalEventStatus;
  rejectionReason?: string | null;
}

export interface StructuredLocalEventResult {
  title: string | null;
  description: string | null;
  benefit: string | null;
  startDate: string | null;
  endDate: string | null;
  storeName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  sourceUrl: string | null;
  confidenceScore: number;
  needsReview: boolean;
}

export interface MapItem {
  id: string;
  type: MapItemType;
  title: string;
  subtitle: string | null;
  lat: number;
  lng: number;
  distanceMeters: number;
  markerType: "parking" | "festival" | "local_event";
  source: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  isSponsored?: boolean;
  priorityScore?: number;
}

export interface DiscoverFestivalsResponse {
  items: Festival[];
  generatedAt: string;
}

export interface DiscoverEventsResponse {
  items: LocalEvent[];
  generatedAt: string;
}

export interface MapItemsResponse {
  items: MapItem[];
  generatedAt: string;
}
