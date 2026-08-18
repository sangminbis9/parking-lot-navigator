import Foundation
import WidgetKit

@MainActor
final class FestivalSyncService: ObservableObject {
    static let widgetKind = "UpcomingFestivalsWidget"

    private let apiClient: APIClientProtocol
    private let appGroupID: String
    private var lastSyncAt: Date?
    private var inflight: Task<Void, Never>?

    init(apiClient: APIClientProtocol, appGroupID: String) {
        self.apiClient = apiClient
        self.appGroupID = appGroupID
    }

    func syncIfStale(coordinate: (lat: Double, lng: Double)?, minimumInterval: TimeInterval = 300) {
        if let lastSyncAt, Date().timeIntervalSince(lastSyncAt) < minimumInterval {
            return
        }
        sync(coordinate: coordinate)
    }

    func sync(coordinate: (lat: Double, lng: Double)?) {
        inflight?.cancel()
        inflight = Task { [weak self] in
            await self?.performSync(coordinate: coordinate)
        }
    }

    /// 백그라운드 refresh처럼 완료를 기다려야 하는 호출부용. `sync`와 달리 반환 시점에 캐시가 갱신돼 있다.
    func syncNow(coordinate: (lat: Double, lng: Double)?) async {
        await performSync(coordinate: coordinate)
    }

    private func performSync(coordinate: (lat: Double, lng: Double)?) async {
        let filter = FestivalFilterStore.load(scope: "shared", appGroupID: appGroupID)
        let widgetFilter = Self.widgetFilter(from: filter)
        let usesRegions = !widgetFilter.regions.isEmpty
        // 지역이 선택되면 반경은 대상 선정에 관여하지 않는다. 좌표 반경으로 먼저 자르면 선택한
        // 지역이 조회 중심에서 멀 때(서울에서 부산 선택) 결과가 통째로 0이 되기 때문이다.
        // 전국을 한 번에 받아 matches()의 주소 기준 판정에 맡긴다.
        let coord = usesRegions ? Self.koreaCenter : resolvedCoordinate(coordinate)
        let radius = usesRegions ? Self.nationwideRadiusMeters : widgetFilter.radiusMeters

        do {
            let festivals = try await apiClient.nearbyFestivals(
                lat: coord.lat,
                lng: coord.lng,
                radiusMeters: radius,
                upcomingWithinDays: widgetFilter.dateRange.upcomingWithinDays
            )
            let filtered = festivals
                .filter { widgetFilter.matches($0) }
                .sorted { lhs, rhs in
                    if lhs.status != rhs.status {
                        return lhs.status == .ongoing
                    }
                    // 전국 조회일 때 distanceMeters는 국토 중심 기준이라 "가까움"을 뜻하지 않는다.
                    if usesRegions { return lhs.startDate < rhs.startDate }
                    if lhs.distanceMeters != rhs.distanceMeters {
                        return lhs.distanceMeters < rhs.distanceMeters
                    }
                    return lhs.startDate < rhs.startDate
                }
            let snapshot = WidgetSnapshot(
                generatedAt: Date(),
                items: Array(filtered.prefix(20))
            )
            SharedFestivalCache.save(snapshot, appGroupID: appGroupID)
            lastSyncAt = Date()
            WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
        } catch {
            // 네트워크 실패 시 기존 캐시 유지
        }
    }

    /// 위젯은 "다가오는 축제"를 보여주는 자리라, 앱 필터가 진행중만 보도록 설정돼 있어도
    /// 곧 시작하는 축제까지 포함한다. 지역·카테고리 등 나머지 조건은 앱 필터를 그대로 따른다.
    private static func widgetFilter(from filter: FestivalFilter) -> FestivalFilter {
        guard filter.dateRange == .ongoingOnly else { return filter }
        var adjusted = filter
        adjusted.dateRange = .oneMonth
        return adjusted
    }

    /// 조회 중심: 전달받은 좌표 → 마지막 알려진 위치 → 기본 좌표.
    /// 앱 진입 시점처럼 좌표를 못 넘기는 호출부가 있어 서울 고정으로 떨어지지 않게 한다.
    private func resolvedCoordinate(_ coordinate: (lat: Double, lng: Double)?) -> (lat: Double, lng: Double) {
        if let coordinate { return coordinate }
        if let last = LastKnownLocationStore.load(appGroupID: appGroupID) { return last }
        return Self.defaultCoordinate
    }

    private static let defaultCoordinate: (lat: Double, lng: Double) = (lat: 37.5663, lng: 126.9779) // 서울시청
    private static let koreaCenter: (lat: Double, lng: Double) = (lat: 36.35, lng: 127.80)
    private static let nationwideRadiusMeters = 460_000
}
