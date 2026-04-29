import type { LodgingOption, LodgingPlatformOffer } from "@parking/shared-types";
import { randomUUID } from "node:crypto";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, LodgingProvider } from "../common/discoverProvider.js";
import { sortByDistance } from "../common/sortDiscover.js";

interface ExpediaTravelRedirectConfig {
  apiKey: string;
  password?: string;
  authorization?: string;
  baseUrl: string;
  locale: string;
  currency: string;
}

interface ExpediaListingsResponse {
  Hotels?: unknown[];
  Errors?: Array<{ Code?: string; Description?: string }>;
}

export class ExpediaTravelRedirectLodgingProvider extends BaseProviderHealth implements LodgingProvider {
  constructor(private readonly config: ExpediaTravelRedirectConfig) {
    super("expedia-travel-redirect-lodging");
  }

  async lodging(query: DiscoverQuery): Promise<LodgingOption[]> {
    try {
      const url = new URL("/hotels/listings", this.config.baseUrl);
      const stay = resolveStayDates(query);
      url.searchParams.set("geoLocation", `${query.lat},${query.lng}`);
      url.searchParams.set("radius", String(Math.min(Math.max(Math.ceil(query.radiusMeters / 1000), 1), 199)));
      url.searchParams.set("unit", "km");
      url.searchParams.set("checkIn", stay.checkIn);
      url.searchParams.set("checkOut", stay.checkOut);
      appendRoomOccupancy(url, query.adults ?? 2, query.rooms ?? 1);
      url.searchParams.set("links", "WEB");
      url.searchParams.set("sortType", "distance");
      url.searchParams.set("sortOrder", "asc");
      url.searchParams.set("locale", this.config.locale);
      url.searchParams.set("currency", this.config.currency);

      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.exp-hotel.v3+json",
          Key: this.config.apiKey,
          Authorization: this.authorizationHeader(),
          "Partner-Transaction-Id": randomUUID()
        }
      });

      const body = (await response.json()) as ExpediaListingsResponse;
      if (!response.ok || body.Errors?.length) {
        throw new Error(formatExpediaErrors(response.status, body.Errors));
      }

      const items = (body.Hotels ?? [])
        .map((hotel) => mapHotel(hotel, query))
        .filter((item): item is LodgingOption => item !== null)
        .filter((item) => item.distanceMeters <= query.radiusMeters);
      this.markSuccess(items.length > 0 ? 1 : 0.7);
      return sortByDistance(items);
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  private authorizationHeader(): string {
    if (this.config.authorization) {
      return this.config.authorization.startsWith("Basic ")
        ? this.config.authorization
        : `Basic ${this.config.authorization}`;
    }
    if (!this.config.password) {
      throw new Error("EXPEDIA_TRAVEL_REDIRECT_PASSWORD or EXPEDIA_TRAVEL_REDIRECT_AUTHORIZATION is required");
    }
    return `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.password}`).toString("base64")}`;
  }
}

function appendRoomOccupancy(url: URL, adults: number, rooms: number): void {
  const resolvedAdults = Math.min(Math.max(adults, 1), 14);
  const resolvedRooms = Math.min(Math.max(rooms, 1), 8, resolvedAdults);
  const adultsPerRoom = Math.max(Math.floor(resolvedAdults / resolvedRooms), 1);
  let remainder = Math.max(resolvedAdults - adultsPerRoom * resolvedRooms, 0);
  for (let index = 1; index <= resolvedRooms; index += 1) {
    const extraAdult = remainder > 0 ? 1 : 0;
    remainder -= extraAdult;
    url.searchParams.set(`room${index}.adults`, String(adultsPerRoom + extraAdult));
  }
}

function resolveStayDates(query: DiscoverQuery): { checkIn: string; checkOut: string } {
  if (query.checkIn && query.checkOut) {
    return { checkIn: query.checkIn, checkOut: query.checkOut };
  }
  const checkIn = new Date();
  checkIn.setUTCDate(checkIn.getUTCDate() + 1);
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkOut.getUTCDate() + 1);
  return {
    checkIn: checkIn.toISOString().slice(0, 10),
    checkOut: checkOut.toISOString().slice(0, 10)
  };
}

function mapHotel(input: unknown, query: DiscoverQuery): LodgingOption | null {
  const hotel = asRecord(input);
  if (!hotel) return null;

  const id = stringValue(hotel, ["HotelId", "EcomHotelId", "Id", "id"]);
  const name = stringValue(hotel, ["Name", "HotelName", "LocalizedHotelName", "name"]);
  const lat = numberValue(hotel, ["Latitude", "latitude", "Location.Latitude", "Location.GeoLocation.Latitude"]);
  const lng = numberValue(hotel, ["Longitude", "longitude", "Location.Longitude", "Location.GeoLocation.Longitude"]);
  if (!id || !name || lat === null || lng === null) return null;

  const room = firstRecord(arrayValue(hotel, ["RoomTypes", "Rooms", "roomTypes"]));
  const priceText = priceTextFromRoom(room);
  const bookingUrl = linkFromHotelOrRoom(hotel, room);
  const rating = numberValue(hotel, ["GuestRating", "ReviewScore", "StarRating", "Rating"]);
  const address = addressText(hotel);

  const offer: LodgingPlatformOffer | null = priceText
    ? {
        platform: "Expedia",
        priceText,
        priceAmount: priceAmountFromText(priceText),
        currency: currencyFromText(priceText) ?? "KRW",
        bookingUrl,
        refundable: booleanValue(room, ["FreeCancellation", "Refundable", "freeCancellation"]),
        includesTaxesAndFees: textMentionsTaxes(priceText)
      }
    : null;

  return {
    id: `expedia:${id}`,
    name,
    lodgingType: stringValue(hotel, ["PropertyType", "Category", "LodgingType"]) ?? "hotel",
    address,
    lat,
    lng,
    distanceMeters: distanceMeters(query.lat, query.lng, lat, lng),
    rating,
    reviewCount: numberValue(hotel, ["ReviewCount", "GuestReviewCount"]),
    imageUrl: imageUrl(hotel),
    source: "expedia-travel-redirect",
    sourceUrl: bookingUrl,
    lowestPriceText: priceText,
    lowestPricePlatform: priceText ? "Expedia" : null,
    offers: offer ? [offer] : [],
    amenities: stringArrayValue(hotel, ["Amenities", "amenities", "GroupedAmenities"])
  };
}

function formatExpediaErrors(status: number, errors: ExpediaListingsResponse["Errors"]): string {
  if (!errors?.length) return `Expedia lodging request failed with HTTP ${status}`;
  return errors.map((error) => `${error.Code ?? "ERROR"}: ${error.Description ?? "Unknown error"}`).join("; ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getPath(record: Record<string, unknown> | null, path: string): unknown {
  if (!record) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    const currentRecord = asRecord(current);
    return currentRecord ? currentRecord[key] : undefined;
  }, record);
}

function stringValue(record: Record<string, unknown> | null, paths: string[]): string | null {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function numberValue(record: Record<string, unknown> | null, paths: string[]): number | null {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function booleanValue(record: Record<string, unknown> | null, paths: string[]): boolean | null {
  for (const path of paths) {
    const value = getPath(record, path);
    if (typeof value === "boolean") return value;
  }
  return null;
}

function arrayValue(record: Record<string, unknown>, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = getPath(record, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstRecord(values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function priceTextFromRoom(room: Record<string, unknown> | null): string | null {
  const price = asRecord(getPath(room, "Price"));
  return (
    stringValue(price, ["DisplayPrice", "FormattedPrice", "TotalPrice.Formatted", "TotalPrice.Display"]) ??
    stringValue(room, ["Price.DisplayPrice", "Price.TotalPrice.Value"]) ??
    null
  );
}

function priceAmountFromText(text: string): number | null {
  const parsed = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function currencyFromText(text: string): string | null {
  const match = text.match(/\b[A-Z]{3}\b/);
  return match?.[0] ?? null;
}

function textMentionsTaxes(text: string): boolean {
  return /tax|fee|세금|수수료/i.test(text);
}

function linkFromHotelOrRoom(hotel: Record<string, unknown>, room: Record<string, unknown> | null): string | null {
  return (
    stringValue(room, ["Links.WebDetails.Href", "Links.WebSearchResult.Href"]) ??
    stringValue(hotel, ["Links.WebDetails.Href", "Links.WebSearchResult.Href", "Url", "url"]) ??
    null
  );
}

function addressText(hotel: Record<string, unknown>): string {
  const direct = stringValue(hotel, ["Address", "AddressLine", "Location.Address"]);
  if (direct) return direct;
  const parts = [
    stringValue(hotel, ["Location.StreetAddress", "StreetAddress"]),
    stringValue(hotel, ["Location.City", "City"]),
    stringValue(hotel, ["Location.Country", "Country"])
  ].filter((part): part is string => Boolean(part));
  return parts.join(", ");
}

function imageUrl(hotel: Record<string, unknown>): string | null {
  const images = arrayValue(hotel, ["Images", "images"]);
  const first = firstRecord(images);
  return stringValue(first, ["Url", "url", "Href", "href"]);
}

function stringArrayValue(record: Record<string, unknown>, paths: string[]): string[] {
  for (const path of paths) {
    const value = getPath(record, path);
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "string" ? item : stringValue(asRecord(item), ["Name", "name", "Description"])))
        .filter((item): item is string => Boolean(item));
    }
  }
  return [];
}
