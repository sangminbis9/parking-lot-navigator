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

    private func performSync(coordinate: (lat: Double, lng: Double)?) async {
        let filter = FestivalFilterStore.load(scope: "shared", appGroupID: appGroupID)
        let coord = coordinate ?? defaultCoordinate
        let radius = filter.radiusMeters

        do {
            let festivals = try await apiClient.nearbyFestivals(
                lat: coord.lat,
                lng: coord.lng,
                radiusMeters: radius,
                upcomingWithinDays: filter.dateRange.upcomingWithinDays
            )
            let filtered = festivals
                .filter { filter.matches($0) }
                .sorted { lhs, rhs in
                    if lhs.status != rhs.status {
                        return lhs.status == .ongoing
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

    private let defaultCoordinate: (lat: Double, lng: Double) = (lat: 37.5663, lng: 126.9779) // 서울시청
}
