import Foundation
import UserNotifications

/// 저장한 축제의 시작 전 로컬 알림을 관리한다. (시작일 전날 오전 9시, Asia/Seoul 기준)
@MainActor
final class FestivalReminderService: ObservableObject {
    /// 현재 알림이 예약된 축제 id 집합. UI 토글 상태 표시에 사용.
    @Published private(set) var scheduledIds: Set<String> = []

    private let center = UNUserNotificationCenter.current()

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        return formatter
    }()

    private static func identifier(for id: String) -> String { "festival-reminder-\(id)" }

    /// 앱 시작 시 한 번 호출해 이미 예약된 알림으로 상태를 동기화한다.
    func refreshScheduled() async {
        let requests = await center.pendingNotificationRequests()
        let ids = requests
            .map(\.identifier)
            .filter { $0.hasPrefix("festival-reminder-") }
            .map { String($0.dropFirst("festival-reminder-".count)) }
        scheduledIds = Set(ids)
    }

    func isScheduled(id: String) -> Bool { scheduledIds.contains(id) }

    /// 권한 요청. 이미 결정된 경우 현재 허용 여부를 반환한다.
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

    /// 축제 시작 전날 오전 9시 알림 예약. 권한이 없으면 false, 예약 시점이 과거면 무시.
    @discardableResult
    func schedule(for festival: SavedFestival) async -> Bool {
        guard await requestAuthorizationIfNeeded() else { return false }
        guard let triggerDate = reminderDate(for: festival.startDate), triggerDate > Date() else {
            return false
        }

        let content = UNMutableNotificationContent()
        content.title = festival.title
        content.body = "\u{B0B4}\u{C77C} \u{C2DC}\u{C791}\u{D574}\u{C694}. \u{C77C}\u{C815}\u{C744} \u{D655}\u{C778}\u{D574} \u{BCF4}\u{C138}\u{C694}." // 내일 시작해요. 일정을 확인해 보세요.
        content.sound = .default

        var components = Calendar(identifier: .gregorian)
        components.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        let dateComponents = components.dateComponents([.year, .month, .day, .hour, .minute], from: triggerDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: false)
        let request = UNNotificationRequest(identifier: Self.identifier(for: festival.id), content: content, trigger: trigger)

        do {
            try await center.add(request)
            scheduledIds.insert(festival.id)
            return true
        } catch {
            return false
        }
    }

    func cancel(id: String) {
        center.removePendingNotificationRequests(withIdentifiers: [Self.identifier(for: id)])
        scheduledIds.remove(id)
    }

    /// 시작일 전날 오전 9시. 시작일이 내일이면 결과가 미래이므로 그대로 예약된다.
    private func reminderDate(for startDate: String) -> Date? {
        guard let start = Self.dayFormatter.date(from: startDate) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        guard let dayBefore = calendar.date(byAdding: .day, value: -1, to: start) else { return nil }
        return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: dayBefore)
    }
}
