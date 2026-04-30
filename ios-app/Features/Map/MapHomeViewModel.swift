import Combine
import CoreLocation
import Foundation

@MainActor
final class MapHomeViewModel: ObservableObject {
    @Published var query = ""
    @Published var destinations: [Destination] = []
    @Published var selectedDestination: Destination?
    @Published var parkingLots: [ParkingLot] = []
    @Published var realtimeParkingLots: [ParkingLot] = []
    @Published var festivals: [Festival] = []
    @Published var events: [FreeEvent] = []
    @Published var lodging: [LodgingOption] = []
    @Published var selectedParkingLot: ParkingLot?
    @Published var selectedFestival: Festival?
    @Published var selectedEvent: FreeEvent?
    @Published var selectedLodging: LodgingOption?
    @Published var showsFestivalLayer = true
    @Published var showsEventLayer = true
    @Published var showsLodgingLayer = false
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
        selectedDestination = destination
        destinations = []
        selectedParkingLot = nil
        parkingLots = []
        selectedFestival = nil
        selectedEvent = nil
        selectedLodging = nil
        recordSelection(destination, queryText: selectedQuery)
        await loadParkingLots(for: destination)
        if showsRealtimeParkingLayer {
            await loadRealtimeParkingLayer()
        }
    }

    func selectFestival(_ festival: Festival) async {
        selectedFestival = festival
        selectedEvent = nil
        selectedLodging = nil
        await selectDiscoverDestination(
            id: "festival-\(festival.id)",
            name: festival.title,
            address: festival.address,
            lat: festival.lat,
            lng: festival.lng,
            source: festival.source,
            rawCategory: festival.tags.joined(separator: ","),
            normalizedCategory: "festival"
        )
    }

    func selectEvent(_ event: FreeEvent) async {
        selectedEvent = event
        selectedFestival = nil
        selectedLodging = nil
        await selectDiscoverDestination(
            id: "event-\(event.id)",
            name: event.title,
            address: event.address,
            lat: event.lat,
            lng: event.lng,
            source: event.source,
            rawCategory: event.eventType,
            normalizedCategory: "event"
        )
    }

    func selectLodging(_ lodging: LodgingOption) async {
        selectedLodging = lodging
        selectedFestival = nil
        selectedEvent = nil
        await selectDiscoverDestination(
            id: "lodging-\(lodging.id)",
            name: lodging.name,
            address: lodging.address,
            lat: lodging.lat,
            lng: lodging.lng,
            source: lodging.source,
            rawCategory: lodging.lodgingType,
            normalizedCategory: "lodging"
        )
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
        selectedFestival = nil
        selectedEvent = nil
        selectedLodging = nil
        guard mode != .parking else { return }
        await loadDiscoverItems(viewport: viewport)
    }

    func clearMapFocus() {
        selectedDestination = nil
        selectedParkingLot = nil
        selectedFestival = nil
        selectedEvent = nil
        selectedLodging = nil
        destinations = []
        parkingLots = []
    }

    func setFestivalLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsFestivalLayer = isVisible
        if !isVisible {
            selectedFestival = nil
            return
        }
        await loadFestivals(viewport: viewport)
    }

    func setEventLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsEventLayer = isVisible
        if !isVisible {
            selectedEvent = nil
            return
        }
        await loadEvents(viewport: viewport)
    }

    func setLodgingLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsLodgingLayer = isVisible
        if !isVisible {
            selectedLodging = nil
            return
        }
        await loadLodging(viewport: viewport)
    }

    func setRealtimeParkingLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsRealtimeParkingLayer = isVisible
        if !isVisible {
            selectedParkingLot = nil
            realtimeParkingLots = []
            return
        }
    }

    func loadRealtimeParkingLayer() async {
        guard showsRealtimeParkingLayer else { return }
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

    func loadInitialDiscoverLayers(viewport: MapViewport) async {
        await loadDiscoverLayers(viewport: viewport)
    }

    func loadDiscoverLayers(viewport: MapViewport) async {
        isLoadingDiscover = true
        errorMessage = nil
        var failedLoads = 0
        var attemptedLoads = 0

        if showsFestivalLayer {
            attemptedLoads += 1
            switch await loadFestivalLayer(viewport: viewport) {
            case .success(let items):
                festivals = items
            case .failure:
                failedLoads += 1
            }
        }
        if showsEventLayer {
            attemptedLoads += 1
            switch await loadEventLayer(viewport: viewport) {
            case .success(let items):
                events = items
            case .failure:
                failedLoads += 1
            }
        }
        if showsLodgingLayer {
            attemptedLoads += 1
            switch await loadLodgingLayer(viewport: viewport) {
            case .success(let items):
                lodging = items
            case .failure:
                failedLoads += 1
            }
        }

        if attemptedLoads > 0 && attemptedLoads == failedLoads {
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
                festivals = try await discoverFestivals(viewport: viewport)
            case .events:
                events = try await discoverEvents(viewport: viewport)
            case .lodging:
                lodging = try await discoverLodging(viewport: viewport)
            }
        } catch {
            errorMessage = "탐색 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoadingDiscover = false
    }

    private func loadFestivals(viewport: MapViewport) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            festivals = try await discoverFestivals(viewport: viewport)
        } catch {
            errorMessage = "\u{CD95}\u{C81C} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func loadEvents(viewport: MapViewport) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            events = try await discoverEvents(viewport: viewport)
        } catch {
            errorMessage = "\u{C774}\u{BCA4}\u{D2B8} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func loadLodging(viewport: MapViewport) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            lodging = try await discoverLodging(viewport: viewport)
        } catch {
            errorMessage = "\u{C219}\u{C18C} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func discoverFestivals(viewport: MapViewport) async throws -> [Festival] {
        return try await apiClient.nearbyFestivals(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: viewportDiscoverRadiusMeters(for: viewport)
        )
    }

    private func discoverEvents(viewport: MapViewport) async throws -> [FreeEvent] {
        return try await apiClient.nearbyEvents(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: viewportDiscoverRadiusMeters(for: viewport)
        )
    }

    private func discoverLodging(viewport: MapViewport) async throws -> [LodgingOption] {
        return try await apiClient.nearbyLodging(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: viewportDiscoverRadiusMeters(for: viewport)
        )
    }

    private func loadFestivalLayer(viewport: MapViewport) async -> Result<[Festival], Error> {
        do {
            return .success(try await discoverFestivals(viewport: viewport))
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

    private func loadLodgingLayer(viewport: MapViewport) async -> Result<[LodgingOption], Error> {
        do {
            return .success(try await discoverLodging(viewport: viewport))
        } catch {
            return .failure(error)
        }
    }

    private func viewportDiscoverRadiusMeters(for viewport: MapViewport) -> Int {
        max(viewport.radiusMeters, localDiscoverRadiusMeters)
    }

    private func selectDiscoverDestination(
        id: String,
        name: String,
        address: String,
        lat: Double,
        lng: Double,
        source: String,
        rawCategory: String?,
        normalizedCategory: String
    ) async {
        exploreMode = .parking
        let destination = Destination(
            id: id,
            name: name,
            address: address,
            lat: lat,
            lng: lng,
            source: source,
            rawCategory: rawCategory,
            normalizedCategory: normalizedCategory
        )
        selectedDestination = destination
        destinations = []
        selectedParkingLot = nil
        parkingLots = []
        await loadParkingLots(for: destination)
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
        case lodging(LodgingOption)
    }

    let id: String
    let coordinate: CLLocationCoordinate2D
    let kind: Kind

    var showsTitleLabel = false
}

private extension CLLocationCoordinate2D {
    func isClose(to other: CLLocationCoordinate2D) -> Bool {
        abs(latitude - other.latitude) <= 0.000001 &&
            abs(longitude - other.longitude) <= 0.000001
    }
}
