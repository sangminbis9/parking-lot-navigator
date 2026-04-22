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
    @Published var realtimeParkingClusters: [RealtimeParkingCluster] = []
    @Published var festivals: [Festival] = []
    @Published var events: [FreeEvent] = []
    @Published var selectedParkingLot: ParkingLot?
    @Published var selectedFestival: Festival?
    @Published var selectedEvent: FreeEvent?
    @Published var showsFestivalLayer = true
    @Published var showsEventLayer = true
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
    private let seoulDiscoverRadiusMeters = 60_000
    private let nationwideDiscoverRadiusMeters = 450_000
    private let realtimeParkingRadiusMeters = 460_000
    private let wideClusterMeters = 20_000
    private let refinedClusterMeters = 5_000
    private let koreaDiscoverCenter = CLLocationCoordinate2D(latitude: 36.35, longitude: 127.80)
    private let seoulDiscoverCenter = CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780)
    private let refinedClusterZoomThreshold = 12
    private let clusterReleaseZoomThreshold = 14

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

    func shouldShowRealtimeClusters(zoomLevel: Int) -> Bool {
        zoomLevel < clusterReleaseZoomThreshold
    }

    func shouldShowDiscoverClusters(zoomLevel: Int) -> Bool {
        zoomLevel < clusterReleaseZoomThreshold
    }

    func realtimeParkingClustersForZoom(zoomLevel: Int) -> [RealtimeParkingCluster] {
        clusterRealtimeParkingItems(visibleRealtimeParkingLots, clusterMeters: clusterMeters(for: zoomLevel))
    }

    func festivalClustersForZoom(zoomLevel: Int) -> [DiscoverCluster] {
        clusterDiscoverItems(festivals, clusterMeters: clusterMeters(for: zoomLevel)) { festival in
            DiscoverClusterItem(
                title: festival.title,
                coordinate: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng)
            )
        }
    }

    func eventClustersForZoom(zoomLevel: Int) -> [DiscoverCluster] {
        clusterDiscoverItems(events, clusterMeters: clusterMeters(for: zoomLevel)) { event in
            DiscoverClusterItem(
                title: event.title,
                coordinate: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
            )
        }
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
        recordSelection(destination, queryText: selectedQuery)
        await loadParkingLots(for: destination)
        if showsRealtimeParkingLayer {
            await loadRealtimeParkingLayer()
        }
    }

    func selectFestival(_ festival: Festival) async {
        selectedFestival = festival
        selectedEvent = nil
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

    func setExploreMode(_ mode: MapExploreMode, center: CLLocationCoordinate2D) async {
        exploreMode = mode
        selectedFestival = nil
        selectedEvent = nil
        guard mode != .parking else { return }
        await loadDiscoverItems(center: center)
    }

    func clearMapFocus() {
        selectedDestination = nil
        selectedParkingLot = nil
        selectedFestival = nil
        selectedEvent = nil
        destinations = []
        parkingLots = []
    }

    func setFestivalLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsFestivalLayer = isVisible
        if !isVisible {
            selectedFestival = nil
            return
        }
        if festivals.isEmpty {
            await loadFestivals(center: center)
        }
    }

    func setEventLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsEventLayer = isVisible
        if !isVisible {
            selectedEvent = nil
            return
        }
        if events.isEmpty {
            await loadEvents(center: center)
        }
    }

    func setRealtimeParkingLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsRealtimeParkingLayer = isVisible
        if !isVisible {
            selectedParkingLot = nil
            realtimeParkingLots = []
            realtimeParkingClusters = []
            return
        }
    }

    func loadRealtimeParkingLayer() async {
        guard showsRealtimeParkingLayer else { return }
        isLoadingRealtimeParking = true
        errorMessage = nil
        do {
            async let lots = apiClient.realtimeParking(
                lat: koreaDiscoverCenter.latitude,
                lng: koreaDiscoverCenter.longitude,
                radiusMeters: realtimeParkingRadiusMeters
            )
            async let clusters = apiClient.realtimeParkingClusters(
                lat: koreaDiscoverCenter.latitude,
                lng: koreaDiscoverCenter.longitude,
                radiusMeters: realtimeParkingRadiusMeters,
                clusterMeters: wideClusterMeters
            )
            realtimeParkingLots = try await lots
            realtimeParkingClusters = try await clusters
        } catch {
            errorMessage = "\u{C2E4}\u{C2DC}\u{AC04} \u{C8FC}\u{CC28} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingRealtimeParking = false
    }

    func loadInitialDiscoverLayers() async {
        await loadInitialDiscoverLayersFromProviderDefaults()
    }

    private func loadInitialDiscoverLayersFromProviderDefaults() async {
        isLoadingDiscover = true
        errorMessage = nil
        var failedLoads = 0
        var attemptedLoads = 0

        if showsFestivalLayer && showsEventLayer {
            attemptedLoads = 2
            async let festivalResult = loadInitialFestivalLayer()
            async let eventResult = loadInitialEventLayer()
            let (loadedFestivals, loadedEvents) = await (festivalResult, eventResult)
            switch loadedFestivals {
            case .success(let items):
                festivals = items
            case .failure:
                failedLoads += 1
            }
            switch loadedEvents {
            case .success(let items):
                events = items
            case .failure:
                failedLoads += 1
            }
        } else if showsFestivalLayer {
            attemptedLoads += 1
            switch await loadInitialFestivalLayer() {
            case .success(let items):
                festivals = items
            case .failure:
                failedLoads += 1
            }
        } else if showsEventLayer {
            attemptedLoads += 1
            switch await loadInitialEventLayer() {
            case .success(let items):
                events = items
            case .failure:
                failedLoads += 1
            }
        }

        if attemptedLoads > 0 && attemptedLoads == failedLoads {
            errorMessage = "\u{D0D0}\u{C0C9} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}. \u{C7A0}\u{C2DC} \u{D6C4} \u{B2E4}\u{C2DC} \u{C2DC}\u{B3C4}\u{D574} \u{C8FC}\u{C138}\u{C694}."
        }
        isLoadingDiscover = false
    }

    func loadDiscoverLayers(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        var failedLoads = 0
        var attemptedLoads = 0

        if showsFestivalLayer && showsEventLayer {
            attemptedLoads = 2
            async let festivalResult = loadFestivalLayer(center: center)
            async let eventResult = loadEventLayer(center: center)
            let (loadedFestivals, loadedEvents) = await (festivalResult, eventResult)
            switch loadedFestivals {
            case .success(let items):
                festivals = items
            case .failure:
                failedLoads += 1
            }
            switch loadedEvents {
            case .success(let items):
                events = items
            case .failure:
                failedLoads += 1
            }
        } else if showsFestivalLayer {
            attemptedLoads += 1
            switch await loadFestivalLayer(center: center) {
            case .success(let items):
                festivals = items
            case .failure:
                failedLoads += 1
            }
        } else if showsEventLayer {
            attemptedLoads += 1
            switch await loadEventLayer(center: center) {
            case .success(let items):
                events = items
            case .failure:
                failedLoads += 1
            }
        }

        if attemptedLoads > 0 && attemptedLoads == failedLoads {
            errorMessage = "\u{D0D0}\u{C0C9} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}. \u{C7A0}\u{C2DC} \u{D6C4} \u{B2E4}\u{C2DC} \u{C2DC}\u{B3C4}\u{D574} \u{C8FC}\u{C138}\u{C694}."
        }
        isLoadingDiscover = false
    }

    func loadDiscoverItems(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            switch exploreMode {
            case .parking:
                break
            case .festivals:
                festivals = try await discoverFestivals(center: center)
            case .events:
                events = try await discoverEvents(center: center)
            }
        } catch {
            errorMessage = "탐색 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoadingDiscover = false
    }

    private func loadFestivals(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            festivals = try await discoverFestivals(center: center)
        } catch {
            errorMessage = "\u{CD95}\u{C81C} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func loadEvents(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            events = try await discoverEvents(center: center)
        } catch {
            errorMessage = "\u{C774}\u{BCA4}\u{D2B8} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func discoverFestivals(center: CLLocationCoordinate2D) async throws -> [Festival] {
        let nearby = try await apiClient.nearbyFestivals(
            lat: center.latitude,
            lng: center.longitude,
            radiusMeters: localDiscoverRadiusMeters
        )
        if !nearby.isEmpty || center.isClose(to: koreaDiscoverCenter) {
            return nearby
        }
        return try await apiClient.nearbyFestivals(
            lat: koreaDiscoverCenter.latitude,
            lng: koreaDiscoverCenter.longitude,
            radiusMeters: nationwideDiscoverRadiusMeters
        )
    }

    private func discoverEvents(center: CLLocationCoordinate2D) async throws -> [FreeEvent] {
        return try await apiClient.nearbyEvents(
            lat: center.latitude,
            lng: center.longitude,
            radiusMeters: localDiscoverRadiusMeters
        )
    }

    private func initialFestivals() async throws -> [Festival] {
        return try await apiClient.nearbyFestivals(
            lat: koreaDiscoverCenter.latitude,
            lng: koreaDiscoverCenter.longitude,
            radiusMeters: nationwideDiscoverRadiusMeters
        )
    }

    private func initialEvents() async throws -> [FreeEvent] {
        return try await apiClient.nearbyEvents(
            lat: seoulDiscoverCenter.latitude,
            lng: seoulDiscoverCenter.longitude,
            radiusMeters: seoulDiscoverRadiusMeters
        )
    }

    private func loadInitialFestivalLayer() async -> Result<[Festival], Error> {
        do {
            return .success(try await initialFestivals())
        } catch {
            return .failure(error)
        }
    }

    private func loadInitialEventLayer() async -> Result<[FreeEvent], Error> {
        do {
            return .success(try await initialEvents())
        } catch {
            return .failure(error)
        }
    }

    private func loadFestivalLayer(center: CLLocationCoordinate2D) async -> Result<[Festival], Error> {
        do {
            return .success(try await discoverFestivals(center: center))
        } catch {
            return .failure(error)
        }
    }

    private func loadEventLayer(center: CLLocationCoordinate2D) async -> Result<[FreeEvent], Error> {
        do {
            return .success(try await discoverEvents(center: center))
        } catch {
            return .failure(error)
        }
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

    private func clusterDiscoverItems<Item>(
        _ items: [Item],
        clusterMeters: Int,
        makeClusterItem: (Item) -> DiscoverClusterItem
    ) -> [DiscoverCluster] {
        var groups: [String: [DiscoverClusterItem]] = [:]
        for item in items.map(makeClusterItem) {
            let key = clusterKey(for: item.coordinate, clusterMeters: clusterMeters)
            groups[key, default: []].append(item)
        }

        return groups.map { key, clusterItems in
            DiscoverCluster(
                id: "\(clusterMeters):\(key)",
                coordinate: averageCoordinate(clusterItems.map(\.coordinate)),
                count: clusterItems.count,
                representativeTitle: clusterItems.first?.title ?? ""
            )
        }
        .sorted { lhs, rhs in
            lhs.id < rhs.id
        }
    }

    private func clusterRealtimeParkingItems(
        _ items: [ParkingLot],
        clusterMeters: Int
    ) -> [RealtimeParkingCluster] {
        var groups: [String: [ParkingLot]] = [:]
        for item in items {
            let key = clusterKey(
                for: CLLocationCoordinate2D(latitude: item.lat, longitude: item.lng),
                clusterMeters: clusterMeters
            )
            groups[key, default: []].append(item)
        }

        return groups.map { key, clusterItems in
            let availableSpaces = sumNullable(clusterItems.map(\.availableSpaces))
            let totalCapacity = sumNullable(clusterItems.map(\.totalCapacity))
            return RealtimeParkingCluster(
                id: "\(clusterMeters):\(key)",
                lat: average(clusterItems.map(\.lat)),
                lng: average(clusterItems.map(\.lng)),
                count: clusterItems.count,
                availableSpaces: availableSpaces,
                totalCapacity: totalCapacity,
                congestionStatus: inferCongestion(availableSpaces: availableSpaces, totalCapacity: totalCapacity)
            )
        }
        .sorted { lhs, rhs in
            lhs.id < rhs.id
        }
    }

    private func clusterMeters(for zoomLevel: Int) -> Int {
        zoomLevel >= refinedClusterZoomThreshold ? refinedClusterMeters : wideClusterMeters
    }

    private func clusterKey(for coordinate: CLLocationCoordinate2D, clusterMeters: Int) -> String {
        let latStep = Double(clusterMeters) / 111_320.0
        let lngStep = Double(clusterMeters) / max(40_000.0, 111_320.0 * cos(koreaDiscoverCenter.latitude * .pi / 180))
        return "\(Int((coordinate.latitude / latStep).rounded())):\(Int((coordinate.longitude / lngStep).rounded()))"
    }

    private func averageCoordinate(_ coordinates: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        let count = max(Double(coordinates.count), 1)
        let lat = coordinates.map(\.latitude).reduce(0, +) / count
        let lng = coordinates.map(\.longitude).reduce(0, +) / count
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    private func average(_ values: [Double]) -> Double {
        values.reduce(0, +) / max(Double(values.count), 1)
    }

    private func sumNullable(_ values: [Int?]) -> Int? {
        let numericValues = values.compactMap { $0 }
        guard !numericValues.isEmpty else { return nil }
        return numericValues.reduce(0, +)
    }

    private func inferCongestion(availableSpaces: Int?, totalCapacity: Int?) -> CongestionStatus {
        if let availableSpaces,
           let totalCapacity,
           totalCapacity > 0 {
            let occupancyRate = 1 - Double(availableSpaces) / Double(totalCapacity)
            if occupancyRate >= 0.98 { return .full }
            if occupancyRate >= 0.85 { return .busy }
            if occupancyRate >= 0.6 { return .moderate }
            return .available
        }
        if let availableSpaces {
            return availableSpaces <= 2 ? .busy : .available
        }
        return .unknown
    }
}

struct DiscoverCluster: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let count: Int
    let representativeTitle: String
}

private struct DiscoverClusterItem {
    let title: String
    let coordinate: CLLocationCoordinate2D
}

struct MapPinItem: Identifiable {
    enum Kind {
        case currentLocation
        case destination(Destination)
        case parking(ParkingLot)
        case realtimeCluster(RealtimeParkingCluster)
        case festivalCluster(DiscoverCluster)
        case eventCluster(DiscoverCluster)
        case festival(Festival)
        case event(FreeEvent)
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
