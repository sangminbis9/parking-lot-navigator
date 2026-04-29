export type DiscoverStatus = "ongoing" | "upcoming";

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
}

export interface LodgingPlatformOffer {
  platform: string;
  priceText: string;
  priceAmount: number | null;
  currency: string;
  bookingUrl: string | null;
  refundable: boolean | null;
  includesTaxesAndFees: boolean;
}

export interface LodgingOption {
  id: string;
  name: string;
  lodgingType: string;
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  source: string;
  sourceUrl: string | null;
  lowestPriceText: string | null;
  lowestPricePlatform: string | null;
  offers: LodgingPlatformOffer[];
  amenities: string[];
}

export interface DiscoverFestivalsResponse {
  items: Festival[];
  generatedAt: string;
}

export interface DiscoverEventsResponse {
  items: FreeEvent[];
  generatedAt: string;
}

export interface DiscoverLodgingResponse {
  items: LodgingOption[];
  generatedAt: string;
}
