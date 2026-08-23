import Foundation
import ImageIO
import UIKit
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
        if let lastSyncAt, Date().timeIntervalSince(lastSyncAt) < minimumInterval { return }
        inflight?.cancel()
        // lastSyncAt은 메모리에만 있어 콜드 스타트마다 nil이었다. 그래서 앱을 열 때마다
        // 지도 탐색 API와 위젯 sync가 같이 출발했다. 디스크 캐시의 생성 시각을 기준으로 삼되,
        // 그 파일을 읽고 디코드하는 일 자체는 메인 스레드 밖에서 한다.
        inflight = Task(priority: .utility) { [weak self] in
            guard let self else { return }
            let appGroupID = self.appGroupID
            let cachedAt = await Task.detached(priority: .utility) {
                SharedFestivalCache.load(appGroupID: appGroupID)?.generatedAt
            }.value
            if Task.isCancelled { return }
            if let cachedAt, Date().timeIntervalSince(cachedAt) < minimumInterval {
                self.lastSyncAt = cachedAt
                return
            }
            await self.performSync(coordinate: coordinate)
        }
    }

    func sync(coordinate: (lat: Double, lng: Double)?) {
        inflight?.cancel()
        // 위젯 갱신은 화면에 보이는 작업이 아니다. 지도/목록 요청에 우선순위를 양보한다.
        inflight = Task(priority: .utility) { [weak self] in
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
        let basis = resolveBasis(filter: widgetFilter, coordinate: coordinate)

        do {
            var collected: [String: Festival] = [:]
            for query in basis.queries {
                let page = try await apiClient.nearbyFestivals(
                    lat: query.lat,
                    lng: query.lng,
                    radiusMeters: query.radiusMeters,
                    upcomingWithinDays: widgetFilter.dateRange.upcomingWithinDays
                )
                for festival in page where collected[festival.id] == nil {
                    collected[festival.id] = festival
                }
            }

            let now = Date()
            // rank를 비교자 안에서 부르면 항목마다 O(log n)번 다시 계산된다. 한 번만 매긴다.
            let usesUserLocation = basis.kind == .location
            let ranked = collected.values
                .filter { widgetFilter.matches($0) }
                .map { (festival: $0, score: Self.rank($0, now: now, usesUserLocation: usesUserLocation)) }
                .sorted { lhs, rhs in
                    if lhs.score != rhs.score { return lhs.score < rhs.score }
                    return lhs.festival.id < rhs.festival.id
                }
            let items = ranked.prefix(Self.maxCachedItems).map(\.festival)

            await refreshThumbnails(for: items)

            let snapshot = WidgetSnapshot(
                generatedAt: now,
                items: items,
                basisKind: basis.kind,
                basisLabel: basis.label,
                hasActiveFilter: !filter.isEmpty
            )
            await Self.persist(snapshot, appGroupID: appGroupID)
            lastSyncAt = now
            WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
        } catch {
            // 네트워크 실패 시 기존 캐시를 그대로 둔다. 위젯은 generatedAt으로 오래됨을 표시한다.
        }
    }

    /// JSONEncoder + 파일 쓰기. 메인 액터(클래스 전체가 @MainActor)에서 하면 앱 진입 직후 UI가 멈춘다.
    private nonisolated static func persist(_ snapshot: WidgetSnapshot, appGroupID: String) async {
        await Task.detached(priority: .utility) {
            SharedFestivalCache.save(snapshot, appGroupID: appGroupID)
        }.value
    }

    // MARK: 조회 기준

    private struct QueryPoint {
        let lat: Double
        let lng: Double
        let radiusMeters: Int
    }

    private struct SyncBasis {
        let kind: WidgetBasisKind
        let label: String
        let queries: [QueryPoint]
    }

    /// 위젯이 무엇을 기준으로 축제를 모을지 정한다.
    /// - 지역 필터가 있으면 그 지역 중심 좌표에서 직접 조회한다. 전국을 한 번에 받아 주소로
    ///   거르던 방식은 서버가 조회 중심에서 가까운 순으로 잘라 주기 때문에, 먼 지역을 고르면
    ///   결과가 통째로 비는 문제가 있었다.
    /// - 지역이 없으면 사용자 위치를 쓰고, 위치를 전혀 모르면 서울로 떨어뜨리는 대신
    ///   전국 기준임을 명시한다.
    private func resolveBasis(filter: FestivalFilter, coordinate: (lat: Double, lng: Double)?) -> SyncBasis {
        let regionPoints = Self.regionQueryPoints(filter.regions)
        if !regionPoints.isEmpty {
            return SyncBasis(kind: .region, label: Self.regionLabel(filter.regions), queries: regionPoints)
        }
        if let coord = coordinate ?? LastKnownLocationStore.load(appGroupID: appGroupID) {
            return SyncBasis(
                kind: .location,
                label: "내 주변",
                queries: [QueryPoint(lat: coord.lat, lng: coord.lng, radiusMeters: filter.radiusMeters)]
            )
        }
        return SyncBasis(
            kind: .nationwide,
            label: "전국",
            queries: [QueryPoint(
                lat: Self.koreaCenter.lat,
                lng: Self.koreaCenter.lng,
                radiusMeters: Self.nationwideRadiusMeters
            )]
        )
    }

    /// 선택 지역을 그 지역 중심 좌표 조회로 바꾼다. 좌표를 모르는 이름은 건너뛴다.
    private static func regionQueryPoints(_ regions: [String]) -> [QueryPoint] {
        regions.prefix(maxRegionQueries).compactMap { region in
            guard let centroid = NotificationPreferencesStore.regionCentroids[region] else { return nil }
            let isProvince = FestivalFilter.koreanRegions.contains(region)
            return QueryPoint(
                lat: centroid.lat,
                lng: centroid.lng,
                radiusMeters: isProvince ? provinceRadiusMeters : cityRadiusMeters
            )
        }
    }

    private static func regionLabel(_ regions: [String]) -> String {
        guard !regions.isEmpty else { return "전국" }
        if regions.count <= 2 { return regions.joined(separator: "·") }
        return "\(regions[0])·\(regions[1]) 외 \(regions.count - 2)"
    }

    /// 정렬 점수(낮을수록 먼저). 진행 중을 앞에 두고, 시작이 임박할수록,
    /// 사용자 위치 기준일 때는 가까울수록 앞으로 온다.
    private static func rank(_ festival: Festival, now: Date, usesUserLocation: Bool) -> Double {
        var score: Double
        if festival.status == .ongoing {
            score = 0
        } else {
            let days = FestivalDateSupport.daysFromToday(festival.startDate, reference: now) ?? 365
            score = 10 + Double(max(days, 0))
        }
        if usesUserLocation {
            score += min(Double(festival.distanceMeters) / 1000, 150) * 0.12
        }
        return score
    }

    // MARK: 썸네일

    /// 위젯이 쓸 작은 JPEG을 App Group에 채운다. 한 회차에 받는 개수를 제한해
    /// 앱 진입 직후 네트워크를 오래 물고 있지 않게 한다.
    private func refreshThumbnails(for items: [Festival]) async {
        let appGroupID = self.appGroupID
        var downloaded = 0
        for festival in items {
            guard downloaded < Self.maxThumbnailDownloads else { break }
            guard !WidgetThumbnailStore.hasThumbnail(festivalID: festival.id, appGroupID: appGroupID) else { continue }
            guard let raw = festival.imageUrl ?? festival.imageUrls.first,
                  let url = URL(string: raw) else { continue }
            downloaded += 1
            guard let data = await Self.downloadThumbnail(url) else { continue }
            let festivalID = festival.id
            await Task.detached(priority: .utility) {
                WidgetThumbnailStore.write(data, festivalID: festivalID, appGroupID: appGroupID)
            }.value
        }
        let ids = items.map(\.id)
        await Task.detached(priority: .utility) {
            WidgetThumbnailStore.prune(keeping: ids, appGroupID: appGroupID)
        }.value
    }

    /// 디코드·재인코드가 무거워 메인 액터(클래스 전체가 @MainActor)에 두면 앱 진입 직후 UI가 멈춘다.
    /// `nonisolated`로 두어 백그라운드 실행자에서 돌린다.
    private nonisolated static func downloadThumbnail(_ url: URL) async -> Data? {
        guard let (data, response) = try? await URLSession.shared.data(from: url) else { return nil }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: thumbnailMaxPixel
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.72)
    }

    /// 위젯은 "다가오는 축제"를 보여주는 자리라, 앱 필터가 진행중만 보도록 설정돼 있어도
    /// 곧 시작하는 축제까지 포함한다. 지역·카테고리 등 나머지 조건은 앱 필터를 그대로 따른다.
    private static func widgetFilter(from filter: FestivalFilter) -> FestivalFilter {
        guard filter.dateRange == .ongoingOnly else { return filter }
        var adjusted = filter
        adjusted.dateRange = .oneMonth
        return adjusted
    }

    private static let koreaCenter: (lat: Double, lng: Double) = (lat: 36.35, lng: 127.80)
    private static let nationwideRadiusMeters = 460_000
    private static let provinceRadiusMeters = 120_000
    private static let cityRadiusMeters = 40_000
    private static let maxRegionQueries = 4
    private static let maxCachedItems = 20
    private static let maxThumbnailDownloads = 8
    private static let thumbnailMaxPixel: CGFloat = 240
}
