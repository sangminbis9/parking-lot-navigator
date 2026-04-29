import Foundation

protocol APIClientProtocol {
    func searchDestination(query: String) async throws -> [Destination]
    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot]
    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot]
    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int) async throws -> [Festival]
    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent]
    func nearbyLodging(lat: Double, lng: Double, radiusMeters: Int) async throws -> [LodgingOption]
    func recordSearchHistory(destination: Destination, queryText: String, deviceId: String) async throws
    func providerHealth() async throws -> [ProviderHealth]
}

final class APIClient: APIClientProtocol {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL = AppConfiguration.current.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func searchDestination(query: String) async throws -> [Destination] {
        var components = URLComponents(url: endpoint("search/destination"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        let response: DestinationSearchResponse = try await get(components.url!)
        return response.items
    }

    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        var components = URLComponents(url: endpoint("parking/nearby"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
        let response: ParkingNearbyResponse = try await get(components.url!)
        return response.items
    }

    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        var components = URLComponents(url: endpoint("parking/realtime"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
        let response: ParkingNearbyResponse = try await get(components.url!)
        return response.items
    }

    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int) async throws -> [Festival] {
        var components = URLComponents(url: endpoint("discover/festivals"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters)),
            URLQueryItem(name: "upcomingWithinDays", value: "30")
        ]
        let response: DiscoverFestivalsResponse = try await get(components.url!)
        return response.items
    }

    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent] {
        var components = URLComponents(url: endpoint("discover/events"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters)),
            URLQueryItem(name: "upcomingWithinDays", value: "30"),
            URLQueryItem(name: "freeOnly", value: "true")
        ]
        let response: DiscoverEventsResponse = try await get(components.url!)
        return response.items
    }

    func nearbyLodging(lat: Double, lng: Double, radiusMeters: Int) async throws -> [LodgingOption] {
        var components = URLComponents(url: endpoint("discover/lodging"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
        let response: DiscoverLodgingResponse = try await get(components.url!)
        return response.items
    }

    func recordSearchHistory(destination: Destination, queryText: String, deviceId: String) async throws {
        struct Payload: Encodable {
            let deviceId: String
            let queryText: String
            let destinationId: String
            let destinationName: String
            let address: String
            let lat: Double
            let lng: Double
            let normalizedCategory: String?
            let rawCategory: String?
            let provider: String
        }

        let payload = Payload(
            deviceId: deviceId,
            queryText: queryText,
            destinationId: destination.id,
            destinationName: destination.name,
            address: destination.address,
            lat: destination.lat,
            lng: destination.lng,
            normalizedCategory: destination.normalizedCategory,
            rawCategory: destination.rawCategory,
            provider: destination.source
        )
        try await post(endpoint("analytics/search-history"), body: payload)
    }

    func providerHealth() async throws -> [ProviderHealth] {
        let response: ProviderHealthResponse = try await get(endpoint("parking/providers/health"))
        return response.providers
    }

    private func endpoint(_ path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            AppLogger.networking.error("API call failed: \(error.localizedDescription)")
            throw error
        }
    }

    private func post<T: Encodable>(_ url: URL, body: T) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}

final class MockAPIClient: APIClientProtocol {
    func searchDestination(query: String) async throws -> [Destination] {
        [
            Destination(id: "dest-seoul-station", name: query.isEmpty ? "Seoul Station" : query, address: "405 Hangang-daero, Jung-gu, Seoul", lat: 37.5547, lng: 126.9706, source: "mock"),
            Destination(id: "dest-cityhall", name: "Seoul City Hall", address: "110 Sejong-daero, Jung-gu, Seoul", lat: 37.5663, lng: 126.9779, source: "mock")
        ]
    }

    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        [
            ParkingLot(id: "mock:1", source: "mock", sourceParkingId: "1", name: "Seoul Station West Public Parking", address: "378 Cheongpa-ro, Yongsan-gu, Seoul", lat: lat + 0.001, lng: lng - 0.001, distanceFromDestinationMeters: 180, totalCapacity: 120, availableSpaces: 18, occupancyRate: 0.85, congestionStatus: .available, realtimeAvailable: true, freshnessTimestamp: ISO8601DateFormatter().string(from: Date()), operatingHours: "24 hours", feeSummary: "KRW 500 / 10 min", supportsEv: true, supportsAccessible: true, isPublic: true, isPrivate: false, stale: false, displayStatus: "Realtime 18 spaces", score: 0.91, provenance: []),
            ParkingLot(id: "mock:2", source: "mock", sourceParkingId: "2", name: "Destination Private Parking", address: "1 Tongil-ro, Jung-gu, Seoul", lat: lat - 0.001, lng: lng + 0.001, distanceFromDestinationMeters: 260, totalCapacity: 60, availableSpaces: nil, occupancyRate: nil, congestionStatus: .moderate, realtimeAvailable: true, freshnessTimestamp: ISO8601DateFormatter().string(from: Date()), operatingHours: "07:00-23:00", feeSummary: "KRW 2,000 / 30 min", supportsEv: false, supportsAccessible: false, isPublic: false, isPrivate: true, stale: false, displayStatus: "Moderate", score: 0.72, provenance: []),
            ParkingLot(id: "mock:3", source: "mock", sourceParkingId: "3", name: "Stale Public Parking", address: "110 Sejong-daero, Jung-gu, Seoul", lat: lat + 0.002, lng: lng + 0.001, distanceFromDestinationMeters: 420, totalCapacity: 80, availableSpaces: 7, occupancyRate: 0.91, congestionStatus: .busy, realtimeAvailable: false, freshnessTimestamp: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -1200)), operatingHours: "09:00-22:00", feeSummary: "KRW 3,000 / hour", supportsEv: false, supportsAccessible: true, isPublic: true, isPrivate: false, stale: true, displayStatus: "Update may be delayed", score: 0.48, provenance: [])
        ]
    }

    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int) async throws -> [Festival] {
        [
            Festival(id: "mock-festival", title: "Seoul Light Festival", subtitle: "Night walk festival", startDate: "2026-04-15", endDate: "2026-04-22", status: .ongoing, venueName: "Seoul Plaza", address: "110 Sejong-daero, Jung-gu, Seoul", lat: lat + 0.001, lng: lng + 0.001, distanceMeters: 160, source: "mock", sourceUrl: nil, imageUrl: nil, tags: ["festival"])
        ]
    }

    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        try await nearbyParking(lat: lat, lng: lng, radiusMeters: radiusMeters).filter {
            $0.realtimeAvailable && $0.availableSpaces != nil
        }
    }

    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent] {
        [
            FreeEvent(id: "mock-event", title: "Free Civic Exhibition", eventType: "exhibition", startDate: "2026-04-15", endDate: "2026-04-20", status: .ongoing, isFree: true, venueName: "Citizens Hall", address: "110 Sejong-daero, Jung-gu, Seoul", lat: lat + 0.0015, lng: lng - 0.001, distanceMeters: 190, source: "mock", sourceUrl: nil, imageUrl: nil, shortDescription: "Free public exhibition")
        ]
    }

    func nearbyLodging(lat: Double, lng: Double, radiusMeters: Int) async throws -> [LodgingOption] {
        [
            LodgingOption(
                id: "mock-lodging-hotel",
                name: "City Stay Hotel",
                lodgingType: "hotel",
                address: "24 Namdaemun-ro, Jung-gu, Seoul",
                lat: lat + 0.002,
                lng: lng + 0.001,
                distanceMeters: 240,
                rating: 4.3,
                reviewCount: 842,
                imageUrl: nil,
                source: "mock",
                sourceUrl: nil,
                lowestPriceText: "KRW 118,000",
                lowestPricePlatform: "Booking.com",
                offers: [
                    LodgingPlatformOffer(platform: "Booking.com", priceText: "KRW 118,000", priceAmount: 118000, currency: "KRW", bookingUrl: nil, refundable: true, includesTaxesAndFees: true),
                    LodgingPlatformOffer(platform: "Agoda", priceText: "KRW 124,000", priceAmount: 124000, currency: "KRW", bookingUrl: nil, refundable: nil, includesTaxesAndFees: false)
                ],
                amenities: ["parking", "wifi", "breakfast"]
            )
        ]
    }

    func recordSearchHistory(destination: Destination, queryText: String, deviceId: String) async throws {}

    func providerHealth() async throws -> [ProviderHealth] {
        [ProviderHealth(name: "mock", status: "up", lastSuccessAt: ISO8601DateFormatter().string(from: Date()), lastError: nil, qualityScore: 1, stale: false)]
    }
}
