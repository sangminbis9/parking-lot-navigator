import Combine
import CoreLocation
import Foundation
import UIKit

@MainActor
final class MapHomeViewModel: ObservableObject {
    @Published var query = ""
    @Published var destinations: [Destination] = []
    @Published var selectedDestination: Destination?
    @Published var parkingLots: [ParkingLot] = [] { didSet { pinDataRevision &+= 1 } }
    @Published var realtimeParkingLots: [ParkingLot] = [] { didSet { pinDataRevision &+= 1 } }
    @Published var staticFreeParkingLots: [ParkingLot] = [] { didSet { pinDataRevision &+= 1 } }
    @Published var festivals: [Festival] = [] { didSet { pinDataRevision &+= 1 } }
    @Published var events: [FreeEvent] = [] { didSet { pinDataRevision &+= 1 } }
    @Published var selectedParkingLot: ParkingLot?
    @Published var selectedDiscoverParkingContext = false
    @Published var showsFestivalLayer = true
    @Published var showsLocalEventLayer = true
    @Published var showsPerformanceLayer = true
    /// 산업·박람회(`primary_category == .tradeExpo`)는 축제와 같은 `/api/festivals` 응답으로 오지만
    /// 지도에서는 별도 토글로 켜고 끈다. 두 토글 중 하나라도 켜져 있으면 축제 레이어를 불러온다.
    @Published var showsTradeExpoLayer = true
    @Published var performances: [PerformanceItem] = [] { didSet { pinDataRevision &+= 1 } }
    @Published var showsRealtimeParkingLayer = false
    @Published var showsFreeParkingLayer = false
    @Published var exploreMode: MapExploreMode = .parking
    @Published var isSearching = false
    @Published var isLoadingParking = false
    @Published var isLoadingDiscover = false
    @Published var isLoadingRealtimeParking = false
    @Published var errorMessage: String?

    /// 지도 핀 파이프라인 memoization 키. 배열을 통째로 비교하는 건 비싸서 "몇 번째 대입인지"만 센다.
    /// 핀 소스가 되는 배열이 새로 대입될 때마다 올라간다.
    private(set) var pinDataRevision = 0

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

    var visibleFreeParkingLots: [ParkingLot] {
        let activeParkingIDs = Set(parkingLots.map(\.id))
        let realtimeFree = realtimeParkingLots.filter { $0.feeSummary == "무료" }
        var seenIDs = Set(realtimeFree.map(\.id))
        let staticFree = staticFreeParkingLots.filter { seenIDs.insert($0.id).inserted }
        return (realtimeFree + staticFree).filter { !activeParkingIDs.contains($0.id) }
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
            if !showsTradeExpoLayer { festivals = [] }
            return
        }
        await loadDiscoverLayers(viewport: viewport, filter: filter)
    }

    func setTradeExpoLayerVisible(_ isVisible: Bool, viewport: MapViewport, filter: FestivalFilter = .default) async {
        showsTradeExpoLayer = isVisible
        if !isVisible {
            if !showsFestivalLayer { festivals = [] }
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

    /// 실시간 주차와 무료 주차장은 같은 주차 핀 자리를 쓰므로 둘 중 하나만 켠다.
    func setRealtimeParkingLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsRealtimeParkingLayer = isVisible
        if !isVisible {
            if !selectedDiscoverParkingContext && !showsFreeParkingLayer {
                selectedParkingLot = nil
                realtimeParkingLots = []
            }
            return
        }
        showsFreeParkingLayer = false
        staticFreeParkingLots = []
        await loadRealtimeParkingLayer()
        noteRealtimeCoverage(around: viewport)
    }

    func setFreeParkingLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
        showsFreeParkingLayer = isVisible
        if !isVisible {
            if !selectedDiscoverParkingContext && !showsRealtimeParkingLayer {
                realtimeParkingLots = []
            }
            staticFreeParkingLots = []
            return
        }
        showsRealtimeParkingLayer = false
        await loadRealtimeParkingLayer()
        await loadStaticFreeParkingLots(viewport: viewport, force: true)
    }

    /// 실시간 주차 제공처는 대전·서울 일부·인천공항뿐이라, 그 밖의 지역에서는 켜도 핀이 하나도 없다.
    /// 조용히 비어 있으면 토글이 고장난 것처럼 보이므로 이유를 알린다.
    private func noteRealtimeCoverage(around viewport: MapViewport) {
        guard errorMessage == nil else { return }
        let center = CLLocation(latitude: viewport.center.latitude, longitude: viewport.center.longitude)
        let radius = Double(max(viewport.radiusMeters, localDiscoverRadiusMeters))
        let hasNearby = realtimeParkingLots.contains { lot in
            center.distance(from: CLLocation(latitude: lot.lat, longitude: lot.lng)) <= radius
        }
        if !hasNearby {
            errorMessage = "이 지역은 아직 실시간 주차 정보가 없습니다. 현재 대전, 서울 일부, 인천공항만 지원합니다."
        }
    }

    func loadRealtimeParkingLayer(force: Bool = false) async {
        guard showsRealtimeParkingLayer || showsFreeParkingLayer || force else { return }
        isLoadingRealtimeParking = true
        errorMessage = nil
        do {
            realtimeParkingLots = try await apiClient.realtimeParking(
                lat: koreaDiscoverCenter.latitude,
                lng: koreaDiscoverCenter.longitude,
                radiusMeters: realtimeParkingRadiusMeters
            )
        } catch {
            if !isCancellation(error) {
                errorMessage = "\u{C2E4}\u{C2DC}\u{AC04} \u{C8FC}\u{CC28} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
            }
        }
        isLoadingRealtimeParking = false
    }

    func loadStaticFreeParkingLots(viewport: MapViewport, force: Bool = false) async {
        guard showsFreeParkingLayer || force else { return }
        do {
            let items = try await apiClient.nearbyParking(
                lat: viewport.center.latitude,
                lng: viewport.center.longitude,
                radiusMeters: viewportDiscoverRadiusMeters(for: viewport)
            )
            staticFreeParkingLots = items.filter { $0.feeSummary == "무료" }
            errorMessage = nil
        } catch {
            if !isCancellation(error) {
                errorMessage = "\u{BB34}\u{B8CC} \u{C8FC}\u{CC28}\u{C7A5} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
            }
        }
    }

    /// 지도를 연달아 움직이면 직전 새로고침 Task가 취소된다. 취소는 실패가 아니므로 오류로 알리지 않는다.
    private func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        return (error as? URLError)?.code == .cancelled
    }

    func loadInitialDiscoverLayers(viewport: MapViewport, filter: FestivalFilter = .default) async {
        await loadDiscoverLayers(viewport: viewport, filter: filter, showsError: false)
    }

    func loadDiscoverLayers(viewport: MapViewport, filter: FestivalFilter = .default, showsError: Bool = false) async {
        isLoadingDiscover = true
        errorMessage = nil

        // 세 요청은 서로 의존하지 않는다. 순차 await면 가장 느린 하나가 아니라 셋의 합만큼 기다린다.
        let wantsFestivals = showsFestivalLayer || showsTradeExpoLayer
        async let festivalResult: Result<[Festival], Error>? = wantsFestivals
            ? await loadFestivalLayer(viewport: viewport, filter: filter)
            : nil
        async let eventResult: Result<[FreeEvent], Error>? = showsLocalEventLayer
            ? await loadEventLayer(viewport: viewport)
            : nil
        async let performanceResult: Result<[PerformanceItem], Error>? = showsPerformanceLayer
            ? await loadPerformanceLayer(viewport: viewport)
            : nil

        let festivalOutcome = await festivalResult
        let eventOutcome = await eventResult
        let performanceOutcome = await performanceResult

        if Task.isCancelled { return }

        var failedLoads = 0
        var attemptedLoads = 0

        // 결과는 한 번에 반영한다. 하나씩 넣으면 그때마다 핀 파이프라인이 처음부터 다시 돈다.
        if let festivalOutcome {
            attemptedLoads += 1
            switch festivalOutcome {
            case .success(let items): festivals = items
            case .failure: failedLoads += 1
            }
        }
        if let eventOutcome {
            attemptedLoads += 1
            switch eventOutcome {
            case .success(let items): events = items
            case .failure: failedLoads += 1
            }
        }
        if let performanceOutcome {
            attemptedLoads += 1
            switch performanceOutcome {
            case .success(let items): performances = items
            case .failure: failedLoads += 1
            }
        }

        if showsError && attemptedLoads > 0 && attemptedLoads == failedLoads {
            errorMessage = "탐색 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
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
        var radiusMeters = viewportDiscoverRadiusMeters(for: viewport)
        if filter.radiusKm != nil {
            radiusMeters = min(radiusMeters, filter.radiusMeters)
        }
        let raw = try await apiClient.nearbyFestivals(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: radiusMeters,
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
        DestinationParkingMatch.isMatch(parkingLot, destination: destination)
    }

    func clearDiscoverParkingContext() {
        selectedDiscoverParkingContext = false
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
    /// 실시간 주차장 핀처럼 혼잡도 색으로 그릴지 여부. false면 단일 parkingBlue.
    var parkingCongestionColored = false
    /// 이 핀이 속한 지도 상단 토글의 색. 배지 테두리를 이 색으로 그려 토글과 핀을 눈으로 잇는다.
    /// nil이면 카테고리 색을 그대로 쓴다.
    var layerTint: UIColor?
    /// 진행 중인 행사. 배지 우측 상단에 LIVE 라벨을 얹는다(테두리 색은 건드리지 않는다).
    var isLive = false
    /// 진행 중 행사의 대표 이미지. 배지 테두리 안쪽을 채운다. 이미 캐시에 있는 것만 들어온다.
    var photo: MapPinPhoto?
}

struct MapPinCluster: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let count: Int
    let memberCoordinates: [CLLocationCoordinate2D]
    /// 멤버 핀의 id ("festival-…"/"event-…"). 같은 장소 스택을 탭했을 때 목록 시트를 채우는 데 쓴다.
    let memberIDs: [String]
    let tint: UIColor
    let isParking: Bool
}

private extension CLLocationCoordinate2D {
    func isClose(to other: CLLocationCoordinate2D) -> Bool {
        abs(latitude - other.latitude) <= 0.000001 &&
            abs(longitude - other.longitude) <= 0.000001
    }
}
