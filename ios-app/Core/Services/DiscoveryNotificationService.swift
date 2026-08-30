import BackgroundTasks
import Foundation
import UserNotifications

/// 백그라운드에서 새로 등록된 가게 이벤트를 찾아 "새 이벤트가 등록되었습니다" 로컬 알림을 보낸다.
///
/// 다가오는 행사(D-30/D-7/D-1) 알림은 여기 없다. 앱을 며칠 안 열어도 정확한 날짜에 와야 하는데
/// `BGAppRefreshTask`는 실행 시점을 보장하지 않아서, 서버(Worker cron + APNs)가 그 몫을 맡는다.
/// 이 서비스는 "발견" 알림 전용이고 발송 시점이 늦어도 의미가 크게 상하지 않는다.
@MainActor
final class DiscoveryNotificationService: ObservableObject {
    static let refreshTaskID = "com.parkingnav.discovery.refresh"

    private let apiClient: APIClientProtocol
    private let appGroupID: String
    private let center = UNUserNotificationCenter.current()

    /// 지역 선택 시 조회 반경. 서버 D1에는 행정구역 컬럼이 없어 여전히 좌표 반경으로 조회한 뒤
    /// `NotificationRegionKey.matches`로 최종 판정하므로, 반경은 선택한 행정구역 전체를
    /// 확실히 덮을 만큼만 넓히면 된다. 경북(울릉군)·인천(옹진군 백령도) 같은 광역도 소속 원거리
    /// 도서까지 province 중심좌표에서 커버하려면 200km 안팎이 필요해 여유를 두고 300km로 둔다.
    private let regionCoverageRadiusMeters = 300_000

    /// 관심 지역 미선택 = 전국 전체. 마지막 위치나 서울시청 기준 반경으로 좁히지 않는다.
    /// FestivalSyncService의 전국 조회와 같은 중심·반경을 쓴다.
    private let koreaCenter: (lat: Double, lng: Double) = (lat: 36.35, lng: 127.80)
    private let nationwideRadiusMeters = 460_000

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

    /// 다음 백그라운드 새로고침 예약. 로컬 이벤트 발견 알림이 꺼져 있으면 예약하지 않는다.
    /// (축제·공연·박람회의 다가오는 알림은 서버가 보내므로 백그라운드 태스크가 필요 없다.)
    func scheduleNextRefresh() {
        let prefs = NotificationPreferencesStore.load(appGroupID: appGroupID)
        guard prefs.localEvent.discoveryEnabled else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskID)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - 발견 실행

    /// 백그라운드 태스크 핸들러에서 호출. 새로 등록된 로컬 이벤트를 알린다.
    func runDiscovery() async {
        let prefs = NotificationPreferencesStore.load(appGroupID: appGroupID)
        guard prefs.localEvent.discoveryEnabled else { return }
        guard await requestAuthorizationIfNeeded() else { return }

        let currentHour = Calendar.seoul.component(.hour, from: Date())
        guard !prefs.isWithinQuietHours(hour: currentHour) else { return }

        await notifyNewLocalEvents(prefs.localEvent)
    }

    // MARK: - 새로 등록된 로컬 이벤트

    /// 한 회차에 개별 알림으로 내보내는 최대 건수. 이보다 많으면 묶음 알림 1건으로 바꾼다.
    /// 초과분을 버리는 게 아니라 표현만 바꾸는 것이라, 알림 대상이 영구 누락되지 않는다.
    private static let maxIndividualNotifications = 3
    /// 묶음 payload에 싣는 행사 수 상한. 알림 payload를 작게 유지한다.
    private static let maxDigestPayloadEvents = 20

    /// 새로 등록된 가게 이벤트를 축제 알림과 같은 형식(대표 이미지 + 상세 이동)으로 보낸다.
    /// 건수가 많으면 개별 알림 대신 묶음 알림 1건으로 내보낸다.
    private func notifyNewLocalEvents(_ prefs: LocalEventNotificationPrefs) async {
        let events = await fetchLocalEvents(regions: prefs.regions)
        let matched = events.filter { event in
            let categoryMatch = prefs.categories.isEmpty || event.primaryCategory.map { prefs.categories.contains($0) } ?? false
            let regionMatch = NotificationRegionKey.matches(address: event.address, regions: prefs.regions)
            return categoryMatch && regionMatch
        }
        let key = "discovery.notifiedIDs.localEvent"
        let known = notifiedIDs(key: key)
        let isFirstRun = !hasSeeded(key: "discovery.seeded.localEvent")
        let newItems = isFirstRun ? [] : matched.filter { !known.contains($0.id) }

        if newItems.count <= Self.maxIndividualNotifications {
            for event in newItems {
                await scheduleNewLocalEventNotification(event)
            }
        } else {
            await scheduleLocalEventDigestNotification(newItems)
        }

        // 최초 실행에서는 기존 항목 전체를 알림 없이 시드한다. 이후에는 이번에 알린 항목을 누적한다.
        syncNotifiedIDs(matched: isFirstRun ? matched.map(\.id) : newItems.map(\.id), key: key)
        if !matched.isEmpty { markSeeded(key: "discovery.seeded.localEvent") }
    }

    /// 새 이벤트가 많을 때 보내는 묶음 알림. 개별 상세로 갈 수 없는 대신 건수를 온전히 전한다.
    private func scheduleLocalEventDigestNotification(_ events: [FreeEvent]) async {
        let content = UNMutableNotificationContent()
        content.title = "🏪 새 이벤트 \(events.count)건"
        let names = events.prefix(2).map(\.title).joined(separator: ", ")
        content.body = events.count > 2 ? "\(names) 외 \(events.count - 2)건이 등록됐어요" : names
        content.sound = .default
        content.threadIdentifier = "new-local-event"
        // 묶음도 어떤 행사가 담겼는지 실어야 알림센터가 행사별 카드를 만든다.
        // 사진·상세는 싣지 않는다 — payload를 작게 두고 앱이 최신 상세를 다시 받아 온다.
        let carried = Array(events.prefix(Self.maxDigestPayloadEvents))
        content.userInfo = [
            AppNotificationKind.kindKey: AppNotificationKind.newLocalEvent,
            AppNotificationKind.eventIdsKey: carried
                .map { "\(AppNotificationKind.localEventKind):\($0.id)" }
                .joined(separator: ","),
            AppNotificationKind.eventTitlesKey: carried.map(\.title).joined(separator: "\n"),
            AppNotificationKind.eventDatesKey: carried.map(\.startDate).joined(separator: ",")
        ]

        let request = UNNotificationRequest(
            identifier: "new-local-event-digest-\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    private func scheduleNewLocalEventNotification(_ event: FreeEvent) async {
        let content = UNMutableNotificationContent()
        content.title = "🏪 \(event.title)"

        var parts = ["새로 등록된 이벤트"]
        if !event.storeName.isEmpty { parts.append(event.storeName) }
        if let benefit = event.benefit, !benefit.isEmpty { parts.append(benefit) }
        content.body = parts.joined(separator: " · ")
        content.sound = .default

        // 옛 payload(`eventJSON`)를 그대로 두되, 공통 계약 키를 함께 싣는다.
        var userInfo: [String: Any] = [
            AppNotificationKind.kindKey: AppNotificationKind.newLocalEvent,
            AppNotificationKind.eventKindKey: AppNotificationKind.localEventKind,
            AppNotificationKind.eventIdKey: event.id,
            AppNotificationKind.occurrenceDateKey: event.startDate,
            AppNotificationKind.eventTitleKey: event.title
        ]
        if let data = try? JSONEncoder().encode(event),
           let jsonString = String(data: data, encoding: .utf8) {
            userInfo["eventJSON"] = jsonString
        }
        content.userInfo = userInfo
        if let attachment = await imageAttachment(urlString: event.imageUrl ?? event.imageUrls.first) {
            content.attachments = [attachment]
        }

        content.threadIdentifier = "new-local-event"

        let request = UNNotificationRequest(
            identifier: "new-local-event-\(event.id)",
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    // MARK: - 알림 내용 헬퍼

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
    /// 지역이 하나도 없으면 전국 전체를 한 번에 조회한다.
    private func fetchLocalEvents(regions: [String]) async -> [FreeEvent] {
        guard !regions.isEmpty else {
            return (try? await apiClient.nearbyEvents(
                lat: koreaCenter.lat, lng: koreaCenter.lng, radiusMeters: nationwideRadiusMeters
            )) ?? []
        }
        var seen = Set<String>()
        var result: [FreeEvent] = []
        for region in regions {
            guard let centroid = NotificationRegionKey.centroid(for: region) else { continue }
            guard let events = try? await apiClient.nearbyEvents(lat: centroid.lat, lng: centroid.lng, radiusMeters: regionCoverageRadiusMeters) else { continue }
            for event in events where !seen.contains(event.id) {
                seen.insert(event.id)
                result.append(event)
            }
        }
        return result
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
