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

    init(
        baseURL: URL = AppConfiguration.current.apiBaseURL,
        session: URLSession = .shared,
        isEnabled: Bool = !ProcessInfo.processInfo.arguments.contains("-uiTesting")
    ) {
        self.baseURL = baseURL
        self.session = session
        self.isEnabled = isEnabled
    }

    func track(_ event: AnalyticsEvent, label: String? = nil) {
        guard isEnabled else { return }
        let key = label.map { "\(event.rawValue)|\($0)" } ?? event.rawValue
        Task { await buffer.add(key) }
    }

    /// 앱이 백그라운드로 갈 때 호출한다. 응답을 기다리지 않는다.
    func flush() {
        guard isEnabled else { return }
        Task {
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
