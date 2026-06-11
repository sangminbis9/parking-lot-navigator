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
    private let notifiedIDLimit = 500

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

    /// 신규 축제가 있으면 요약 알림을 보낸다.
    private func discoverFestivals(_ prefs: FestivalNotificationPrefs) async {
        let coord = coordinate(forRegions: prefs.regions)
        let radius = prefs.radiusKm * 1_000
        guard let festivals = try? await apiClient.nearbyFestivals(lat: coord.lat, lng: coord.lng, radiusMeters: radius) else { return }
        let matched = festivals.filter { festival in
            prefs.categories.isEmpty || festival.primaryCategory.map { prefs.categories.contains($0) } ?? false
        }
        let key = "discovery.notifiedIDs.festival"
        let known = notifiedIDs(key: key)
        let newItems = matched.filter { !known.contains($0.id) }
        guard !newItems.isEmpty else { return }

        let title = "\u{ADFC}\u{CC98} \u{C0C8} \u{CD95}\u{C81C}" // 근처 새 축제
        let body = "\u{AD00}\u{C2EC} \u{C9C0}\u{C5ED}\u{C5D0} \u{C0C8}\u{B85C} \u{CD94}\u{AC00}\u{B41C} \u{CD95}\u{C81C} \(newItems.count)\u{AC74}\u{C774} \u{C788}\u{C5B4}\u{C694}." // 관심 지역에 새로 추가된 축제 N건이 있어요.
        await scheduleSummary(idPrefix: "discovery-festival", title: title, body: body)
        addNotifiedIDs(newItems.map(\.id), key: key)
    }

    /// 신규 로컬 이벤트가 있으면 요약 알림을 보낸다.
    private func discoverLocalEvents(_ prefs: LocalEventNotificationPrefs) async {
        let coord = coordinate(forRegions: prefs.regions)
        let radius = prefs.radiusKm * 1_000
        guard let events = try? await apiClient.nearbyEvents(lat: coord.lat, lng: coord.lng, radiusMeters: radius) else { return }
        let matched = events.filter { event in
            prefs.categories.isEmpty || event.primaryCategory.map { prefs.categories.contains($0) } ?? false
        }
        let key = "discovery.notifiedIDs.localEvent"
        let known = notifiedIDs(key: key)
        let newItems = matched.filter { !known.contains($0.id) }
        guard !newItems.isEmpty else { return }

        let title = "\u{ADFC}\u{CC98} \u{C0C8} \u{C774}\u{BCA4}\u{D2B8}" // 근처 새 이벤트
        let body = "\u{AD00}\u{C2EC} \u{C9C0}\u{C5ED}\u{C5D0} \u{C0C8}\u{B85C} \u{CD94}\u{AC00}\u{B41C} \u{B85C}\u{CEEC} \u{C774}\u{BCA4}\u{D2B8} \(newItems.count)\u{AC74}\u{C774} \u{C788}\u{C5B4}\u{C694}." // 관심 지역에 새로 추가된 로컬 이벤트 N건이 있어요.
        await scheduleSummary(idPrefix: "discovery-localEvent", title: title, body: body)
        addNotifiedIDs(newItems.map(\.id), key: key)
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

    // MARK: - 조회 중심 좌표

    private func coordinate(forRegions regions: [String]) -> (lat: Double, lng: Double) {
        let centroids = regions.compactMap { NotificationPreferencesStore.regionCentroids[$0] }
        if !centroids.isEmpty {
            let lat = centroids.map(\.lat).reduce(0, +) / Double(centroids.count)
            let lng = centroids.map(\.lng).reduce(0, +) / Double(centroids.count)
            return (lat, lng)
        }
        if let last = LastKnownLocationStore.load(appGroupID: appGroupID) {
            return last
        }
        return defaultCoordinate
    }

    // MARK: - app-group 상태 (이미 알린 ID / 일일 카운트)

    private func defaults() -> UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    private func notifiedIDs(key: String) -> Set<String> {
        guard let stored = defaults()?.stringArray(forKey: key) else { return [] }
        return Set(stored)
    }

    private func addNotifiedIDs(_ ids: [String], key: String) {
        guard let defaults = defaults() else { return }
        var current = defaults.stringArray(forKey: key) ?? []
        current.append(contentsOf: ids.filter { !current.contains($0) })
        if current.count > notifiedIDLimit {
            current = Array(current.suffix(notifiedIDLimit))
        }
        defaults.set(current, forKey: key)
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
