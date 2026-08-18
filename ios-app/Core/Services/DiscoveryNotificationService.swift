import BackgroundTasks
import Foundation
import UserNotifications

/// 백그라운드에서 관심 조건(카테고리·지역·반경)에 맞는 새 축제/로컬 이벤트를 찾아 로컬 알림을 보낸다.
/// 서버 푸시(APNs)가 없으므로 `BGAppRefreshTask`로 best-effort 동작한다.
@MainActor
final class DiscoveryNotificationService: ObservableObject {
    static let refreshTaskID = "com.parkingnav.discovery.refresh"

    private let apiClient: APIClientProtocol
    private let appGroupID: String
    private let center = UNUserNotificationCenter.current()

    private let defaultCoordinate: (lat: Double, lng: Double) = (lat: 37.5663, lng: 126.9779) // 서울시청

    /// 지역 선택 시 조회 반경. 서버 D1에는 행정구역 컬럼이 없어 여전히 좌표 반경으로 조회한 뒤
    /// matchesRegions(주소 문자열 포함 여부)로 최종 판정하므로, 반경은 선택한 행정구역 전체를
    /// 확실히 덮을 만큼만 넓히면 된다. 경북(울릉군)·인천(옹진군 백령도) 같은 광역도 소속 원거리
    /// 도서까지 province 중심좌표에서 커버하려면 200km 안팎이 필요해 여유를 두고 300km로 둔다.
    /// 사용자가 설정한 radiusKm은 지역 선택 시 이 값에 관여하지 않는다 — 반경이 알림 대상 선정에
    /// 영향을 주지 않아야 한다는 요구사항 그대로다.
    private let regionCoverageRadiusMeters = 300_000

    init(apiClient: APIClientProtocol, appGroupID: String) {
        self.apiClient = apiClient
        self.appGroupID = appGroupID
    }

    // MARK: - 권한

    /// 권한 요청. 이미 결정된 경우 현재 허용 여부를 반환한다.
    @discardableResult
    func requestAuthorizationIfNeeded() async -> Bool {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        @unknown default:
            return false
        }
    }

    // MARK: - 백그라운드 예약

    /// 다음 백그라운드 새로고침 예약. 발견 알림이 모두 꺼져 있으면 예약하지 않는다.
    func scheduleNextRefresh() {
        let prefs = NotificationPreferencesStore.load(appGroupID: appGroupID)
        guard prefs.anyDiscoveryEnabled else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskID)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - 발견 실행

    /// 백그라운드 태스크 핸들러에서 호출. 각 도메인의 신규 항목을 찾아 요약 알림을 예약한다.
    func runDiscovery() async {
        let prefs = NotificationPreferencesStore.load(appGroupID: appGroupID)
        guard prefs.anyDiscoveryEnabled else { return }
        guard await requestAuthorizationIfNeeded() else { return }

        let currentHour = Calendar.seoul.component(.hour, from: Date())
        guard !prefs.isWithinQuietHours(hour: currentHour) else { return }

        if prefs.festival.discoveryEnabled {
            await discoverFestivals(prefs.festival)
        }
        if prefs.localEvent.discoveryEnabled {
            await discoverLocalEvents(prefs.localEvent)
        }
    }

    /// 신규 축제를 1건씩 개별 알림으로 보낸다. 최초 실행(known이 비어있음)에는 기존 매칭 항목을
    /// 알림 없이 시드만 하여, 이미 지도에 있던 축제 전체가 "신규"로 오인되지 않게 한다.
    private func discoverFestivals(_ prefs: FestivalNotificationPrefs) async {
        let festivals = await fetchFestivals(regions: prefs.regions, radiusKm: prefs.radiusKm)
        let matched = festivals.filter { festival in
            let categoryMatch = prefs.categories.isEmpty || festival.primaryCategory.map { prefs.categories.contains($0) } ?? false
            let regionMatch = prefs.regions.isEmpty || matchesRegions(address: festival.address, regions: prefs.regions)
            return categoryMatch && regionMatch
        }
        let key = "discovery.notifiedIDs.festival"
        let known = notifiedIDs(key: key)
        let isFirstRun = known.isEmpty
        let newItems = isFirstRun ? [] : matched.filter { !known.contains($0.id) }

        for festival in newItems {
            await scheduleIndividualFestivalNotification(festival)
        }
        syncNotifiedIDs(matched: matched.map(\.id), key: key)
    }

    private func scheduleIndividualFestivalNotification(_ festival: Festival) async {
        let emoji = festival.primaryCategory?.emoji ?? "🎪"
        let content = UNMutableNotificationContent()
        content.title = "\(emoji) \(festival.title)"
        let venue = festival.venueName ?? festival.address
        content.body = "\(venue) · \(festival.startDate) ~ \(festival.endDate)"
        content.sound = .default

        if let data = try? JSONEncoder().encode(festival),
           let jsonString = String(data: data, encoding: .utf8) {
            content.userInfo = ["festivalJSON": jsonString]
        }

        let request = UNNotificationRequest(
            identifier: "discovery-festival-\(festival.id)-\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    /// 신규 로컬 이벤트가 있으면 요약 알림을 보낸다.
    private func discoverLocalEvents(_ prefs: LocalEventNotificationPrefs) async {
        let events = await fetchLocalEvents(regions: prefs.regions, radiusKm: prefs.radiusKm)
        let matched = events.filter { event in
            let categoryMatch = prefs.categories.isEmpty || event.primaryCategory.map { prefs.categories.contains($0) } ?? false
            let regionMatch = prefs.regions.isEmpty || matchesRegions(address: event.address, regions: prefs.regions)
            return categoryMatch && regionMatch
        }
        let key = "discovery.notifiedIDs.localEvent"
        let known = notifiedIDs(key: key)
        let isFirstRun = known.isEmpty
        let newItems = isFirstRun ? [] : matched.filter { !known.contains($0.id) }

        if !newItems.isEmpty {
            let title = "\u{ADFC}\u{CC98} \u{C0C8} \u{C774}\u{BCA4}\u{D2B8}" // 근처 새 이벤트
            let body = "\u{AD00}\u{C2EC} \u{C9C0}\u{C5ED}\u{C5D0} \u{C0C8}\u{B85C} \u{CD94}\u{AC00}\u{B41C} \u{B85C}\u{CEEC} \u{C774}\u{BCA4}\u{D2B8} \(newItems.count)\u{AC74}\u{C774} \u{C788}\u{C5B4}\u{C694}." // 관심 지역에 새로 추가된 로컬 이벤트 N건이 있어요.
            await scheduleSummary(idPrefix: "discovery-localEvent", title: title, body: body)
        }
        syncNotifiedIDs(matched: matched.map(\.id), key: key)
    }

    private func scheduleSummary(idPrefix: String, title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(
            identifier: "\(idPrefix)-\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil // 즉시 전달
        )
        try? await center.add(request)
    }

    // MARK: - 지역 기반 조회

    /// 관심 지역이 있으면 지역별 중심 좌표로 각각 조회해 합친다. 좌표 하나로 평균 내면 서로 먼 지역을
    /// 고를 때 검색 중심이 둘 중 어디에도 속하지 않는 엉뚱한 지점으로 뭉개지기 때문이다.
    private func fetchFestivals(regions: [String], radiusKm: Int) async -> [Festival] {
        guard !regions.isEmpty else {
            let coord = fallbackCoordinate()
            let radius = radiusKm * 1_000
            return (try? await apiClient.nearbyFestivals(lat: coord.lat, lng: coord.lng, radiusMeters: radius, upcomingWithinDays: 365)) ?? []
        }
        var seen = Set<String>()
        var result: [Festival] = []
        for region in regions {
            guard let centroid = NotificationPreferencesStore.regionCentroids[region] else { continue }
            guard let festivals = try? await apiClient.nearbyFestivals(lat: centroid.lat, lng: centroid.lng, radiusMeters: regionCoverageRadiusMeters, upcomingWithinDays: 365) else { continue }
            for festival in festivals where !seen.contains(festival.id) {
                seen.insert(festival.id)
                result.append(festival)
            }
        }
        return result
    }

    private func fetchLocalEvents(regions: [String], radiusKm: Int) async -> [FreeEvent] {
        guard !regions.isEmpty else {
            let coord = fallbackCoordinate()
            let radius = radiusKm * 1_000
            return (try? await apiClient.nearbyEvents(lat: coord.lat, lng: coord.lng, radiusMeters: radius)) ?? []
        }
        var seen = Set<String>()
        var result: [FreeEvent] = []
        for region in regions {
            guard let centroid = NotificationPreferencesStore.regionCentroids[region] else { continue }
            guard let events = try? await apiClient.nearbyEvents(lat: centroid.lat, lng: centroid.lng, radiusMeters: regionCoverageRadiusMeters) else { continue }
            for event in events where !seen.contains(event.id) {
                seen.insert(event.id)
                result.append(event)
            }
        }
        return result
    }

    /// 지역 미선택 시 조회 중심: 마지막 알려진 위치, 없으면 기본 좌표.
    private func fallbackCoordinate() -> (lat: Double, lng: Double) {
        if let last = LastKnownLocationStore.load(appGroupID: appGroupID) {
            return last
        }
        return defaultCoordinate
    }

    /// 서버는 좌표 반경으로만 필터링하므로, 반환된 항목의 주소에 선택한 지역명이 실제로 포함되는지
    /// 다시 검증한다. (반경 조회만으로는 지역 경계를 넘는 항목까지 섞여 들어올 수 있다.)
    private func matchesRegions(address: String, regions: [String]) -> Bool {
        regions.contains { address.contains($0) }
    }

    // MARK: - app-group 상태 (이미 알린 ID / 일일 카운트)

    private func defaults() -> UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    private func notifiedIDs(key: String) -> Set<String> {
        guard let stored = defaults()?.stringArray(forKey: key) else { return [] }
        return Set(stored)
    }

    /// "이미 알림 보냄" 집합에 이번 주기의 매칭 결과를 누적한다. 위치 이동 등으로 반경 중심이 바뀌어
    /// 어떤 축제가 일시적으로 매칭에서 빠졌다가 다시 들어오더라도, 한 번 알림 대상이었던 id는 계속
    /// 남아있어 재알림되지 않는다. (대체가 아니라 합집합이어야 한다 — 대체하면 매 사이클 매칭 결과가
    /// 달라질 때마다 기존 축제가 "신규"로 오인된다.)
    private func syncNotifiedIDs(matched: [String], key: String) {
        guard let defaults = defaults() else { return }
        let known = notifiedIDs(key: key)
        let updated = known.union(matched)
        defaults.set(Array(updated), forKey: key)
    }

}

/// 백그라운드 발견 조회의 fallback 중심점으로 쓸 마지막 알려진 좌표. 포그라운드에서 위치를 얻을 때 갱신한다.
enum LastKnownLocationStore {
    private static let latKey = "lastKnownLocation.lat"
    private static let lngKey = "lastKnownLocation.lng"
    private static let hasKey = "lastKnownLocation.has"

    static func save(lat: Double, lng: Double, appGroupID: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        defaults.set(lat, forKey: latKey)
        defaults.set(lng, forKey: lngKey)
        defaults.set(true, forKey: hasKey)
    }

    static func load(appGroupID: String) -> (lat: Double, lng: Double)? {
        guard let defaults = UserDefaults(suiteName: appGroupID), defaults.bool(forKey: hasKey) else { return nil }
        return (defaults.double(forKey: latKey), defaults.double(forKey: lngKey))
    }
}

extension Calendar {
    /// Asia/Seoul 기준 그레고리력. 방해 금지 시간대 판정 등에 사용.
    static let seoul: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        return calendar
    }()
}
