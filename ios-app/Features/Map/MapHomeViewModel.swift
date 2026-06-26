import Combine
import CoreLocation
import Foundation
import UIKit

@MainActor
final class MapHomeViewModel: ObservableObject {
    @Published var query = ""
    @Published var destinations: [Destination] = []
    @Published var selectedDestination: Destination?
    @Published var parkingLots: [ParkingLot] = []
    @Published var realtimeParkingLots: [ParkingLot] = []
    @Published var festivals: [Festival] = []
    @Published var events: [FreeEvent] = []
    @Published var selectedParkingLot: ParkingLot?
    @Published var selectedDiscoverParkingContext = false
    @Published var showsFestivalLayer = true
    @Published var showsLocalEventLayer = true
    @Published var showsPerformanceLayer = false
    @Published var performances: [PerformanceItem] = []
    @Published var showsRealtimeParkingLayer = false
    @Published var exploreMode: MapExploreMode = .parking
    @Published var isSearching = false
    @Published var isLoadingParking = false
    @Published var isLoadingDiscover = false
    @Published var isLoadingRealtimeParking = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private let recommendationEngine = ParkingRecommendationEngine()
    private let localDiscoverRadiusMeters = 20_000
    private let realtimeParkingRadiusMeters = 460_000
    private let koreaDiscoverCenter = CLLocationCoordinate2D(latitude: 36.35, longitude: 127.80)

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    var parkingRecommendations: [ParkingRecommendation] {
        guard let selectedDestination else { return [] }
        return recommendationEngine.recommendations(for: parkingLots, destination: selectedDestination)
    }

    var recommendedParkingLots: [ParkingLot] {
        parkingRecommendations.map(\.parkingLot)
    }

    var visibleRealtimeParkingLots: [ParkingLot] {
        let activeParkingIDs = Set(parkingLots.map(\.id))
        return realtimeParkingLots.filter { !activeParkingIDs.contains($0.id) }
    }

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        errorMessage = nil
        do {
            destinations = try await apiClient.searchDestination(query: trimmed)
        } catch {
            errorMessage = "목적지 검색에 실패했습니다. 네트워크 상태를 확인해 주세요."
        }
        isSearching = false
    }

    func select(_ destination: Destination) async {
        let selectedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        exploreMode = .parking
        selectedDiscoverParkingContext = false
        selectedDestination = destination
        destinations = []
        selectedParkingLot = nil
        parkingLots = []
        recordSelection(destination, queryText: selectedQuery)
        await loadParkingLots(for: destination)
        if showsRealtimeParkingLayer {
            await loadRealtimeParkingLayer()
        }
    }

    func loadNearbyParkingLots(around coordinate: CLLocationCoordinate2D, radiusMeters: Int = 800) async {
        isLoadingParking = true
        errorMessage = nil
        do {
            let items = try await apiClient.nearbyParking(lat: coordinate.latitude, lng: coordinate.longitude, radiusMeters: radiusMeters)
            parkingLots = items
        } catch {
            errorMessage = "주변 주차장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoadingParking = false
    }

    func loadParkingLots(for destination: Destination) async {
        let destinationID = destination.id
        isLoadingParking = true
        errorMessage = nil
        do {
            let items = try await apiClient.nearbyParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
            guard selectedDestination?.id == destinationID else { return }
            parkingLots = items
            selectedParkingLot = recommendedParkingLots.first
        } catch {
            guard selectedDestination?.id == destinationID else { return }
            errorMessage = "주변 주차장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        if selectedDestination?.id == destinationID {
            isLoadingParking = false
        }
    }

    func setExploreMode(_ mode: MapExploreMode, viewport: MapViewport) async {
        exploreMode = mode
        guard mode != .parking else { return }
        await loadDiscoverItems(viewport: viewport)
    }

    func clearMapFocus() {
        let hadDestination = selectedDestination != nil
        let hadDiscoverContext = selectedDiscoverParkingContext
        selectedDiscoverParkingContext = false
        selectedDestination = nil
        destinations = []
        if hadDestination || hadDiscoverContext {
            selectedParkingLot = nil
            parkingLots = []
        }
    }

    func loadParkingPinsAround(_ coordinate: CLLocationCoordinate2D) async {
        selectedDiscoverParkingContext = true
        selectedDestination = nil
        selectedParkingLot = nil
        parkingLots = []
        await loadNearbyParkingLots(around: coordinate, radiusMeters: 800)
    }

    func setFestivalLayerVisible(_ isVisible: Bool, viewport: MapViewport, filter: FestivalFilter = .default) async {
        showsFestivalLayer = isVisible
        if !isVisible {
            festivals = []
            return
        }
        await loadDiscoverLayers(viewport: viewport, filter: filter)
    }

    func setLocalEventLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsLocalEventLayer = isVisible
        if !isVisible {
            events = []
            return
        }
        await loadDiscoverLayers(viewport: viewport)
    }

    func setPerformanceLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsPerformanceLayer = isVisible
        if !isVisible {
            performances = []
            return
        }
        await loadDiscoverLayers(viewport: viewport)
    }

    func setRealtimeParkingLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsRealtimeParkingLayer = isVisible
        if !isVisible {
            if !selectedDiscoverParkingContext {
                selectedParkingLot = nil
                realtimeParkingLots = []
            }
            return
        }
    }

    func loadRealtimeParkingLayer(force: Bool = false) async {
        guard showsRealtimeParkingLayer || force else { return }
        isLoadingRealtimeParking = true
        errorMessage = nil
        do {
            realtimeParkingLots = try await apiClient.realtimeParking(
                lat: koreaDiscoverCenter.latitude,
                lng: koreaDiscoverCenter.longitude,
                radiusMeters: realtimeParkingRadiusMeters
            )
        } catch {
            errorMessage = "\u{C2E4}\u{C2DC}\u{AC04} \u{C8FC}\u{CC28} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingRealtimeParking = false
    }

    func loadInitialDiscoverLayers(viewport: MapViewport, filter: FestivalFilter = .default) async {
        await loadDiscoverLayers(viewport: viewport, filter: filter, showsError: false)
    }

    func loadDiscoverLayers(viewport: MapViewport, filter: FestivalFilter = .default, showsError: Bool = false) async {
        isLoadingDiscover = true
        errorMessage = nil
        var failedLoads = 0
        var attemptedLoads = 0

        if showsFestivalLayer {
            attemptedLoads += 1
            switch await loadFestivalLayer(viewport: viewport, filter: filter) {
            case .success(let items):
                festivals = items
            case .failure:
                failedLoads += 1
            }
        }
        if showsLocalEventLayer {
            attemptedLoads += 1
            switch await loadEventLayer(viewport: viewport) {
            case .success(let items):
                events = items
            case .failure:
                failedLoads += 1
            }
        }
        if showsPerformanceLayer {
            attemptedLoads += 1
            switch await loadPerformanceLayer(viewport: viewport) {
            case .success(let items):
                performances = items
            case .failure:
                failedLoads += 1
            }
        }
        if showsError && attemptedLoads > 0 && attemptedLoads == failedLoads {
            errorMessage = "\u{D0D0}\u{C0C9} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}. \u{C7A0}\u{C2DC} \u{D6C4} \u{B2E4}\u{C2DC} \u{C2DC}\u{B3C4}\u{D574} \u{C8FC}\u{C138}\u{C694}."
        }
        isLoadingDiscover = false
    }

    func loadDiscoverItems(viewport: MapViewport) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            switch exploreMode {
            case .parking:
                break
            case .festivals:
                festivals = try await discoverFestivals(viewport: viewport, filter: .default)
            case .events:
                events = try await discoverEvents(viewport: viewport)
            }
        } catch {
            errorMessage = "탐색 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoadingDiscover = false
    }

    private func discoverFestivals(viewport: MapViewport, filter: FestivalFilter) async throws -> [Festival] {
        let raw = try await apiClient.nearbyFestivals(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: viewportDiscoverRadiusMeters(for: viewport),
            upcomingWithinDays: filter.dateRange.upcomingWithinDays
        )
        return raw.filter { filter.matches($0) }
    }

    private func discoverEvents(viewport: MapViewport) async throws -> [FreeEvent] {
        return try await apiClient.nearbyEvents(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: viewportDiscoverRadiusMeters(for: viewport)
        )
    }

    private func loadFestivalLayer(viewport: MapViewport, filter: FestivalFilter) async -> Result<[Festival], Error> {
        do {
            return .success(try await discoverFestivals(viewport: viewport, filter: filter))
        } catch {
            return .failure(error)
        }
    }

    private func loadEventLayer(viewport: MapViewport) async -> Result<[FreeEvent], Error> {
        do {
            return .success(try await discoverEvents(viewport: viewport))
        } catch {
            return .failure(error)
        }
    }

    private func loadPerformanceLayer(viewport: MapViewport) async -> Result<[PerformanceItem], Error> {
        do {
            let result = try await apiClient.nearbyPerformances(
                lat: viewport.center.latitude,
                lng: viewport.center.longitude,
                radiusMeters: viewportDiscoverRadiusMeters(for: viewport),
                upcomingWithinDays: 365
            )
            let items = result.festivals.map { PerformanceItem.festival($0) }
                + result.events.map { PerformanceItem.event($0) }
            return .success(items)
        } catch {
            return .failure(error)
        }
    }

    private func viewportDiscoverRadiusMeters(for viewport: MapViewport) -> Int {
        max(viewport.radiusMeters, localDiscoverRadiusMeters)
    }

    private func recordSelection(_ destination: Destination, queryText: String) {
        let deviceId = AnonymousDeviceStore.deviceID()
        Task {
            do {
                try await apiClient.recordSearchHistory(destination: destination, queryText: queryText, deviceId: deviceId)
            } catch {
                AppLogger.networking.warning("search history record failed: \(error.localizedDescription)")
            }
        }
    }

    func isDestinationParking(_ parkingLot: ParkingLot, for destination: Destination) -> Bool {
        guard parkingLot.distanceFromDestinationMeters <= 120 else { return false }
        if parkingLot.distanceFromDestinationMeters <= 100 { return true }
        let destinationTokens = tokens(from: destination.name + " " + destination.address)
        let parkingTokens = tokens(from: parkingLot.name + " " + parkingLot.address)
        return !destinationTokens.isDisjoint(with: parkingTokens)
    }

    func clearDiscoverParkingContext() {
        selectedDiscoverParkingContext = false
    }

    private func tokens(from text: String) -> Set<String> {
        let separators = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
        return Set(text
            .lowercased()
            .components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 2 && !$0.contains("주차") })
    }

}

struct MapPinItem: Identifiable {
    enum Kind {
        case currentLocation
        case destination(Destination)
        case parking(ParkingLot)
        case festival(Festival)
        case event(FreeEvent)
        case cluster(MapPinCluster)
    }

    let id: String
    let coordinate: CLLocationCoordinate2D
    let kind: Kind

    var showsTitleLabel = false
}

struct MapPinCluster: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let count: Int
    let memberCoordinates: [CLLocationCoordinate2D]
    let tint: UIColor
    let isParking: Bool
}

private extension CLLocationCoordinate2D {
    func isClose(to other: CLLocationCoordinate2D) -> Bool {
        abs(latitude - other.latitude) <= 0.000001 &&
            abs(longitude - other.longitude) <= 0.000001
    }
}
