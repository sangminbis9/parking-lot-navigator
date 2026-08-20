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

    /// 백그라운드 태스크 핸들러에서 호출. 다가오는 축제와 새로 등록된 로컬 이벤트를 알린다.
    func runDiscovery() async {
        let prefs = NotificationPreferencesStore.load(appGroupID: appGroupID)
        guard prefs.anyDiscoveryEnabled else { return }
        guard await requestAuthorizationIfNeeded() else { return }

        let currentHour = Calendar.seoul.component(.hour, from: Date())
        guard !prefs.isWithinQuietHours(hour: currentHour) else { return }

        if prefs.festival.discoveryEnabled {
            await notifyUpcomingFestivals(prefs.festival)
        }
        if prefs.localEvent.discoveryEnabled {
            await notifyNewLocalEvents(prefs.localEvent)
        }
    }

    // MARK: - 다가오는 축제/공연/박람회

    /// 시작까지 남은 일수를 알리는 기준. `/api/festivals`가 축제·공연(KOPIS)·박람회(AKEI)를
    /// 한꺼번에 돌려주므로 세 도메인 모두 이 경로 하나로 알린다.
    private static let upcomingThresholds = [30, 7, 1]

    /// 한 회차 알림 상한. BGAppRefreshTask에 주어지는 실행 시간이 수십 초뿐인데 항목마다
    /// 이미지 다운로드가 한 번씩 붙는다. 상한에 걸린 항목은 표시를 남기지 않아 다음 회차에
    /// 다시 후보로 올라온다.
    private static let maxNotificationsPerRun = 3

    /// 하루 알림 상한. 지역 전체가 대상이라 하루에 수십 건이 잡힐 수 있어 알림 피로를 막는다.
    private static let maxNotificationsPerDay = 10

    /// 선택한 지역의 다가오는 축제를 D-30 / D-7 / D-1 구간마다 한 번씩 알린다.
    /// 최초 실행에서는 현재 구간을 알림 없이 표시만 해 둔다 — 그러지 않으면 이미 지도에 있던
    /// 축제 전체가 한꺼번에 밀려 나온다. 표시하지 않은 더 가까운 구간(D-7·D-1)은 그대로 남으므로
    /// 최초 실행 이후에도 알림은 계속 온다.
    private func notifyUpcomingFestivals(_ prefs: FestivalNotificationPrefs) async {
        let festivals = await fetchFestivals(regions: prefs.regions, radiusKm: prefs.radiusKm)
        let matched = festivals.filter { festival in
            let categoryMatch = prefs.categories.isEmpty || festival.primaryCategory.map { prefs.categories.contains($0) } ?? false
            let regionMatch = prefs.regions.isEmpty || matchesRegions(address: festival.address, regions: prefs.regions)
            return categoryMatch && regionMatch
        }

        let key = "discovery.notifiedThresholds.festival"
        var marks = notifiedIDs(key: key)
        let isFirstRun = !hasSeeded(key: "discovery.seeded.festival")
        let today = Calendar.seoul.startOfDay(for: Date())

        var candidates: [(festival: Festival, daysLeft: Int, threshold: Int)] = []
        for festival in matched {
            guard let daysLeft = Self.daysUntil(festival.startDate, from: today) else { continue }
            guard let threshold = Self.thresholdBucket(daysLeft: daysLeft) else {
                // 이미 시작했거나 끝난 축제는 "다가오는" 알림 대상이 아니다.
                continue
            }
            let mark = Self.markKey(festival.id, threshold)
            guard !marks.contains(mark) else { continue }
            if isFirstRun {
                marks.insert(mark)
            } else {
                candidates.append((festival, daysLeft, threshold))
            }
        }

        // 시작이 임박한 순서로 보내, 상한에 걸리더라도 가장 급한 것부터 나간다.
        candidates.sort { $0.daysLeft < $1.daysLeft }
        var budget = min(Self.maxNotificationsPerRun, remainingDailyBudget())
        for candidate in candidates {
            guard budget > 0 else { break }
            await scheduleUpcomingFestivalNotification(candidate.festival, daysLeft: candidate.daysLeft, threshold: candidate.threshold)
            marks.insert(Self.markKey(candidate.festival.id, candidate.threshold))
            budget -= 1
            bumpDailyCount()
        }

        defaults()?.set(Array(marks), forKey: key)
        // 조회 자체가 실패해 빈 결과가 온 회차를 "시드 완료"로 남기면, 다음 회차에 기존 축제 전체가
        // 신규로 오인돼 쏟아진다. 실제로 뭔가 조회된 회차만 시드로 인정한다.
        if !matched.isEmpty { markSeeded(key: "discovery.seeded.festival") }
    }

    private func scheduleUpcomingFestivalNotification(_ festival: Festival, daysLeft: Int, threshold: Int) async {
        let emoji = festival.primaryCategory?.emoji ?? "🎪"
        let content = UNMutableNotificationContent()
        content.title = "\(emoji) \(festival.title)"

        var parts = [Self.remainingPhrase(daysLeft: daysLeft)]
        let place = festival.venueName ?? festival.address
        if !place.isEmpty { parts.append(place) }
        if let start = Self.dayFormatter.date(from: festival.startDate) {
            parts.append("\(Self.displayDateFormatter.string(from: start)) 시작")
        }
        content.body = parts.joined(separator: " · ")
        content.sound = .default

        if let data = try? JSONEncoder().encode(festival),
           let jsonString = String(data: data, encoding: .utf8) {
            content.userInfo = ["festivalJSON": jsonString]
        }
        if let attachment = await imageAttachment(urlString: festival.imageUrl ?? festival.imageUrls.first) {
            content.attachments = [attachment]
        }

        let request = UNNotificationRequest(
            identifier: "upcoming-festival-\(festival.id)-\(threshold)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    // MARK: - 새로 등록된 로컬 이벤트

    /// 새로 등록된 가게 이벤트를 축제 알림과 같은 형식(대표 이미지 + 상세 이동)으로 1건씩 보낸다.
    private func notifyNewLocalEvents(_ prefs: LocalEventNotificationPrefs) async {
        let events = await fetchLocalEvents(regions: prefs.regions, radiusKm: prefs.radiusKm)
        let matched = events.filter { event in
            let categoryMatch = prefs.categories.isEmpty || event.primaryCategory.map { prefs.categories.contains($0) } ?? false
            let regionMatch = prefs.regions.isEmpty || matchesRegions(address: event.address, regions: prefs.regions)
            return categoryMatch && regionMatch
        }
        let key = "discovery.notifiedIDs.localEvent"
        let known = notifiedIDs(key: key)
        let isFirstRun = !hasSeeded(key: "discovery.seeded.localEvent")
        let newItems = isFirstRun ? [] : matched.filter { !known.contains($0.id) }

        var budget = min(Self.maxNotificationsPerRun, remainingDailyBudget())
        var notified: [String] = []
        for event in newItems {
            guard budget > 0 else { break }
            await scheduleNewLocalEventNotification(event)
            notified.append(event.id)
            budget -= 1
            bumpDailyCount()
        }

        // 상한에 걸려 아직 보내지 못한 항목은 표시하지 않아야 다음 회차에 다시 후보가 된다.
        // 최초 실행에서는 기존 항목 전체를 알림 없이 시드한다.
        syncNotifiedIDs(matched: isFirstRun ? matched.map(\.id) : notified, key: key)
        if !matched.isEmpty { markSeeded(key: "discovery.seeded.localEvent") }
    }

    private func scheduleNewLocalEventNotification(_ event: FreeEvent) async {
        let content = UNMutableNotificationContent()
        content.title = "🏪 \(event.title)"

        var parts = ["새로 등록된 이벤트"]
        if !event.storeName.isEmpty { parts.append(event.storeName) }
        if let benefit = event.benefit, !benefit.isEmpty { parts.append(benefit) }
        content.body = parts.joined(separator: " · ")
        content.sound = .default

        if let data = try? JSONEncoder().encode(event),
           let jsonString = String(data: data, encoding: .utf8) {
            content.userInfo = ["eventJSON": jsonString]
        }
        if let attachment = await imageAttachment(urlString: event.imageUrl ?? event.imageUrls.first) {
            content.attachments = [attachment]
        }

        let request = UNNotificationRequest(
            identifier: "new-local-event-\(event.id)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    // MARK: - 알림 내용 헬퍼

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static let displayDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "M월 d일"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.locale = Locale(identifier: "ko_KR")
        return formatter
    }()

    /// "yyyy-MM-dd"와 오늘(Asia/Seoul 자정) 사이의 일수. 이미 지난 날짜면 음수.
    private static func daysUntil(_ dayString: String, from today: Date) -> Int? {
        guard let target = dayFormatter.date(from: dayString) else { return nil }
        let targetDay = Calendar.seoul.startOfDay(for: target)
        return Calendar.seoul.dateComponents([.day], from: today, to: targetDay).day
    }

    /// 남은 일수가 속한 알림 구간. 30일 구간은 8–30일, 7일 구간은 2–7일, 1일 구간은 0–1일이다.
    /// 백그라운드 실행이 하루를 건너뛰어도 구간 안이면 늦게라도 한 번은 나간다.
    /// 이미 시작한(음수) 축제는 어느 구간에도 들지 않는다.
    private static func thresholdBucket(daysLeft: Int) -> Int? {
        guard daysLeft >= 0 else { return nil }
        return upcomingThresholds.last { daysLeft <= $0 }
    }

    private static func markKey(_ id: String, _ threshold: Int) -> String { "\(id)#\(threshold)" }

    private static func remainingPhrase(daysLeft: Int) -> String {
        switch daysLeft {
        case 0: return "오늘 시작해요!"
        case 1: return "내일 시작해요!"
        default: return "\(daysLeft)일 남았어요!"
        }
    }

    /// 대표 사진을 내려받아 알림 첨부로 만든다. `UNNotificationAttachment`는 로컬 파일만 받는다.
    /// 백그라운드 실행 시간이 짧아 실패·지연은 그냥 포기하고 사진 없는 알림으로 내보낸다.
    private func imageAttachment(urlString: String?) async -> UNNotificationAttachment? {
        guard let urlString, let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        guard let result = try? await URLSession.shared.data(for: request) else { return nil }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              !data.isEmpty, data.count <= 10 * 1024 * 1024 else {
            return nil
        }
        // 확장자로 형식을 판별하므로, 원본 URL에 확장자가 없으면 jpg로 둔다.
        let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("notification-\(UUID().uuidString).\(ext)")
        guard (try? data.write(to: fileURL)) != nil else { return nil }
        // 첨부에 성공하면 iOS가 파일을 자기 저장소로 옮겨 간다. 실패한 경우에만 직접 지운다.
        guard let attachment = try? UNNotificationAttachment(identifier: UUID().uuidString, url: fileURL) else {
            try? FileManager.default.removeItem(at: fileURL)
            return nil
        }
        return attachment
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

    /// 최초 실행 여부. 저장된 집합이 비었는지로 판정하면 매칭 결과가 0건인 날마다 다시 "최초"가 되어
    /// 시드가 반복되므로, 별도 플래그로 남긴다.
    private func hasSeeded(key: String) -> Bool {
        defaults()?.bool(forKey: key) ?? false
    }

    private func markSeeded(key: String) {
        defaults()?.set(true, forKey: key)
    }

    private static let dailyCountKey = "discovery.dailyCount"
    private static let dailyCountDateKey = "discovery.dailyCountDate"

    /// 오늘 남은 알림 개수. 날짜(Asia/Seoul)가 바뀌면 카운트를 0부터 다시 센다.
    private func remainingDailyBudget() -> Int {
        guard let defaults = defaults() else { return 0 }
        let today = Self.dayFormatter.string(from: Date())
        guard defaults.string(forKey: Self.dailyCountDateKey) == today else { return Self.maxNotificationsPerDay }
        return max(0, Self.maxNotificationsPerDay - defaults.integer(forKey: Self.dailyCountKey))
    }

    private func bumpDailyCount() {
        guard let defaults = defaults() else { return }
        let today = Self.dayFormatter.string(from: Date())
        let current = defaults.string(forKey: Self.dailyCountDateKey) == today ? defaults.integer(forKey: Self.dailyCountKey) : 0
        defaults.set(today, forKey: Self.dailyCountDateKey)
        defaults.set(current + 1, forKey: Self.dailyCountKey)
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
