import Foundation

@MainActor
final class ParkingResultsViewModel: ObservableObject {
    @Published var recommendations: [ParkingRecommendation] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isEmptyResult = false

    private let destination: Destination
    private let apiClient: APIClientProtocol
    private let recommendationEngine = ParkingRecommendationEngine()

    init(destination: Destination, apiClient: APIClientProtocol) {
        self.destination = destination
        self.apiClient = apiClient
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        isEmptyResult = false

        async let nearbyResult = parkingResult {
            try await apiClient.nearbyParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
        }
        async let realtimeResult = parkingResult {
            try await apiClient.realtimeParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
        }

        let nearby = await nearbyResult
        let realtime = await realtimeResult
        let items = mergedParkingLots(nearby: nearby.items, realtime: realtime.items)

        if !items.isEmpty {
            recommendations = recommendationEngine.recommendations(for: items, destination: destination)
        } else if nearby.didFail && realtime.didFail {
            recommendations = []
            errorMessage = "주변 주차장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        } else {
            recommendations = []
            isEmptyResult = true
        }
        isLoading = false
    }

    private func parkingResult(_ load: () async throws -> [ParkingLot]) async -> Result<[ParkingLot], Error> {
        do {
            return .success(try await load())
        } catch {
            return .failure(error)
        }
    }

    private func mergedParkingLots(nearby: [ParkingLot], realtime: [ParkingLot]) -> [ParkingLot] {
        var itemsByKey: [String: ParkingLot] = [:]
        var orderedKeys: [String] = []

        func append(_ parkingLot: ParkingLot, prefersRealtime: Bool) {
            let key = dedupeKey(for: parkingLot)
            if let existing = itemsByKey[key] {
                itemsByKey[key] = prefersRealtime ? preferredRealtime(existing: existing, candidate: parkingLot) : existing
            } else {
                itemsByKey[key] = parkingLot
                orderedKeys.append(key)
            }
        }

        nearby.forEach { append($0, prefersRealtime: false) }
        realtime.forEach { append($0, prefersRealtime: true) }

        return orderedKeys.compactMap { itemsByKey[$0] }
    }

    private func preferredRealtime(existing: ParkingLot, candidate: ParkingLot) -> ParkingLot {
        if candidate.realtimeAvailable && !existing.realtimeAvailable { return candidate }
        if candidate.freshnessTimestamp != nil && existing.freshnessTimestamp == nil { return candidate }
        if !candidate.stale && existing.stale { return candidate }
        return candidate
    }

    private func dedupeKey(for parkingLot: ParkingLot) -> String {
        let name = normalizedKeyPart(parkingLot.name)
        let address = normalizedKeyPart(parkingLot.address)
        if !name.isEmpty && !address.isEmpty {
            return "\(name)|\(address)"
        }
        if !parkingLot.sourceParkingId.isEmpty {
            return "\(parkingLot.source)|\(parkingLot.sourceParkingId)"
        }
        return parkingLot.id
    }

    private func normalizedKeyPart(_ value: String) -> String {
        value
            .lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .joined()
    }
}

private extension Result where Success == [ParkingLot] {
    var items: [ParkingLot] {
        (try? get()) ?? []
    }

    var didFail: Bool {
        if case .failure = self { return true }
        return false
    }
}
