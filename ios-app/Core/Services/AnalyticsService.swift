import Foundation

/// 익명 사용 집계.
///
/// 기기 식별자, 세션 id, 좌표, 검색어를 보내지 않는다. 이벤트 이름과 정해진 라벨의
/// 횟수만 메모리에 모아 두었다가 앱이 백그라운드로 갈 때 한 번에 올린다. 전송은
/// fire-and-forget이라 서버가 죽어도 앱 동작에 영향이 없고, 실패한 카운트는 조용히
/// 버린다(재시도 큐를 두면 그만큼 개인 행동 이력을 기기에 오래 남기게 된다).
enum AnalyticsEvent: String {
    case appOpen = "app_open"
    case mapLoaded = "map_loaded"
    case eventPinTap = "event_pin_tap"
    case eventDetailOpen = "event_detail_open"
    case favoriteAdd = "favorite_add"
    case calendarOpen = "calendar_open"
    case notificationOpen = "notification_open"
    case parkingView = "parking_view"
    case navigationStart = "navigation_start"
    case reportSubmit = "report_submit"
    case merchantRegisterTap = "merchant_register_tap"
    case emptyResult = "empty_result"
    case apiError = "api_error"
    /// 라벨이 로컬 이벤트 id다. 사장님 대시보드 조회수로 쓰이고 기기·이벤트당 한 번만 보낸다.
    case localEventView = "local_event_view"
}

actor AnalyticsBuffer {
    private var counts: [String: Int] = [:]

    func add(_ key: String) {
        counts[key, default: 0] += 1
    }

    func drain() -> [String: Int] {
        let snapshot = counts
        counts = [:]
        return snapshot
    }
}

final class AnalyticsService {
    static let shared = AnalyticsService()

    private struct Entry: Encodable {
        let name: String
        let label: String?
        let count: Int
    }

    private struct Batch: Encodable {
        let events: [Entry]
    }

    private let buffer = AnalyticsBuffer()
    private let baseURL: URL
    private let session: URLSession
    private let isEnabled: Bool
    private let dailyActiveGate: DailyActiveGate

    init(
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        session: URLSession = .shared,
        isEnabled: Bool = !ProcessInfo.processInfo.arguments.contains("-uiTesting"),
        dailyActiveGate: DailyActiveGate = DailyActiveGate()
    ) {
        self.baseURL = baseURL
        self.session = session
        self.isEnabled = isEnabled
        self.dailyActiveGate = dailyActiveGate
    }

    func track(_ event: AnalyticsEvent, label: String? = nil) {
        guard isEnabled else { return }
        let key = label.map { "\(event.rawValue)|\($0)" } ?? event.rawValue
        Task { await buffer.add(key) }
    }

    /// 같은 기기가 같은 이벤트를 여러 번 열어도 한 명으로 센다.
    func trackLocalEventView(id: String, gate: SeenEventGate = SeenEventGate()) {
        guard isEnabled, gate.markSeen(id) else { return }
        track(.localEventView, label: id)
    }

    /// 서버에 기기 식별자를 보내지 않고 설치별 KST 하루 최대 한 번만 app_open을 센다.
    /// 수치는 로그인 사용자 수가 아니라 best-effort 일일 활성 설치 수다.
    func trackDailyActive(now: Date = Date()) {
        guard isEnabled, dailyActiveGate.shouldRecord(now: now) else { return }
        Task {
            await buffer.add(AnalyticsEvent.appOpen.rawValue)
            await flushBuffered()
        }
    }

    /// 앱이 백그라운드로 갈 때 호출한다. 응답을 기다리지 않는다.
    func flush() {
        guard isEnabled else { return }
        Task { await flushBuffered() }
    }

    private func flushBuffered() async {
        let counts = await buffer.drain()
        guard !counts.isEmpty else { return }
        let entries = counts.map { key, count -> Entry in
            let parts = key.split(separator: "|", maxSplits: 1)
            return Entry(
                name: String(parts[0]),
                label: parts.count > 1 ? String(parts[1]) : nil,
                count: count
            )
        }
        await send(Batch(events: Array(entries.prefix(40))))
    }

    private func send(_ batch: Batch) async {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/analytics"))
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONEncoder().encode(batch)
            _ = try await session.data(for: request)
        } catch {
            // 집계는 실패해도 사용자에게 알릴 것이 없다.
            AppLogger.networking.debug("analytics flush skipped: \(error.localizedDescription)")
        }
    }
}

final class DailyActiveGate {
    private let defaults: UserDefaults
    private let key: String
    private var calendar: Calendar

    init(
        defaults: UserDefaults = .standard,
        key: String = "analytics.lastDailyActiveDay",
        timeZone: TimeZone = TimeZone(identifier: "Asia/Seoul")!
    ) {
        self.defaults = defaults
        self.key = key
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        self.calendar = calendar
    }

    func shouldRecord(now: Date = Date()) -> Bool {
        let components = calendar.dateComponents([.year, .month, .day], from: now)
        let day = String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
        guard defaults.string(forKey: key) != day else { return false }
        defaults.set(day, forKey: key)
        return true
    }
}

/// 이 기기에서 조회수를 이미 보낸 로컬 이벤트 id. 최근 500개만 남긴다.
final class SeenEventGate {
    private let defaults: UserDefaults
    private let key: String
    private let limit = 500

    init(defaults: UserDefaults = .standard, key: String = "analytics.seenLocalEventIds") {
        self.defaults = defaults
        self.key = key
    }

    /// 처음 보는 id면 기록하고 true.
    func markSeen(_ id: String) -> Bool {
        var ids = defaults.stringArray(forKey: key) ?? []
        guard !ids.contains(id) else { return false }
        ids.append(id)
        defaults.set(Array(ids.suffix(limit)), forKey: key)
        return true
    }
}
