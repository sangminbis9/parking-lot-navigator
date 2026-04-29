import type { LodgingOption, ProviderHealth } from "@parking/shared-types";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, LodgingProvider } from "../common/discoverProvider.js";
import { sortByDistance } from "../common/sortDiscover.js";

export class MockLodgingProvider implements LodgingProvider {
  async lodging(query: DiscoverQuery): Promise<LodgingOption[]> {
    const items: LodgingOption[] = [
      {
        id: "mock-lodging-hotel",
        name: "City Stay Hotel",
        lodgingType: "hotel",
        address: "24 Namdaemun-ro, Jung-gu, Seoul",
        lat: query.lat + 0.002,
        lng: query.lng + 0.001,
        distanceMeters: distanceMeters(query.lat, query.lng, query.lat + 0.002, query.lng + 0.001),
        rating: 4.3,
        reviewCount: 842,
        imageUrl: null,
        source: "mock",
        sourceUrl: null,
        lowestPriceText: "KRW 118,000",
        lowestPricePlatform: "Booking.com",
        offers: [
          {
            platform: "Booking.com",
            priceText: "KRW 118,000",
            priceAmount: 118000,
            currency: "KRW",
            bookingUrl: null,
            refundable: true,
            includesTaxesAndFees: true
          },
          {
            platform: "Agoda",
            priceText: "KRW 124,000",
            priceAmount: 124000,
            currency: "KRW",
            bookingUrl: null,
            refundable: null,
            includesTaxesAndFees: false
          }
        ],
        amenities: ["parking", "wifi", "breakfast"]
      },
      {
        id: "mock-lodging-guesthouse",
        name: "Local Guesthouse",
        lodgingType: "guesthouse",
        address: "8 Sejong-daero 18-gil, Jung-gu, Seoul",
        lat: query.lat - 0.0015,
        lng: query.lng + 0.0015,
        distanceMeters: distanceMeters(query.lat, query.lng, query.lat - 0.0015, query.lng + 0.0015),
        rating: 4.6,
        reviewCount: 214,
        imageUrl: null,
        source: "mock",
        sourceUrl: null,
        lowestPriceText: "KRW 72,000",
        lowestPricePlatform: "HotelsCombined",
        offers: [
          {
            platform: "HotelsCombined",
            priceText: "KRW 72,000",
            priceAmount: 72000,
            currency: "KRW",
            bookingUrl: null,
            refundable: false,
            includesTaxesAndFees: true
          },
          {
            platform: "Trip.com",
            priceText: "KRW 79,000",
            priceAmount: 79000,
            currency: "KRW",
            bookingUrl: null,
            refundable: true,
            includesTaxesAndFees: true
          }
        ],
        amenities: ["wifi", "late-check-in"]
      }
    ];
    return sortByDistance(items).filter((item) => item.distanceMeters <= query.radiusMeters);
  }

  health(): ProviderHealth {
    return {
      name: "mock-lodging",
      status: "up",
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      qualityScore: 1,
      stale: false
    };
  }
}
