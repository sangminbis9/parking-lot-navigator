import Foundation
import UserNotifications

/// 저장한 축제의 시작 전 로컬 알림을 관리한다. (시작일 전날 오전 9시, Asia/Seoul 기준)
@MainActor
final class FestivalReminderService: ObservableObject {
    /// 현재 알림이 예약된 축제 id 집합. UI 토글 상태 표시에 사용.
    @Published private(set) var scheduledIds: Set<String> = []

    private let center = UNUserNotificationCenter.current()
    private let appGroupID: String

    init(appGroupID: String) {
        self.appGroupID = appGroupID
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
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

    private static func identifier(for id: String) -> String { "festival-reminder-\(id)" }

    /// leadDays에 대응하는 알림 문구. 설정 화면의 옵션(0/1/3/7)에 맞춘다.
    private static func leadPhrase(for leadDays: Int) -> String {
        switch leadDays {
        case 0: return "오늘 시작해요"
        case 1: return "내일 시작해요"
        case 3: return "3일 뒤 시작해요"
        case 7: return "다음 주 시작해요"
        default: return leadDays <= 0 ? "오늘 시작해요" : "\(leadDays)일 뒤 시작해요"
        }
    }

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
        let prefs = NotificationPreferencesStore.load(appGroupID: appGroupID).festival
        guard prefs.savedReminderEnabled else { return false }
        guard await requestAuthorizationIfNeeded() else { return false }
        guard let triggerDate = reminderDate(for: festival.startDate, leadDays: prefs.leadDays, hour: prefs.reminderHour),
              triggerDate > Date() else {
            return false
        }

        var bodyParts = [Self.leadPhrase(for: prefs.leadDays)]
        if let start = Self.dayFormatter.date(from: festival.startDate) {
            bodyParts.append(Self.displayDateFormatter.string(from: start))
        }
        if let venue = festival.venueName, !venue.isEmpty {
            bodyParts.append(venue)
        }

        let content = UNMutableNotificationContent()
        content.title = festival.title
        content.body = bodyParts.joined(separator: " · ")
        content.sound = .default
        // 어느 행사의 어느 회차인지 알림 자신이 실어야 알림센터가 카드를 만들 수 있다.
        // 서버 푸시와 같은 계약을 쓴다.
        content.userInfo = [
            AppNotificationKind.kindKey: AppNotificationKind.savedReminder,
            AppNotificationKind.eventKindKey: AppNotificationKind.festivalKind,
            AppNotificationKind.eventIdKey: festival.id,
            AppNotificationKind.occurrenceDateKey: festival.startDate,
            AppNotificationKind.eventTitleKey: festival.title
        ]

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

    /// 시작일에서 `leadDays`일 전, 지정한 `hour`시(Asia/Seoul). leadDays=0이면 당일.
    private func reminderDate(for startDate: String, leadDays: Int, hour: Int) -> Date? {
        guard let start = Self.dayFormatter.date(from: startDate) else { return nil }
        let calendar = Calendar.seoul
        guard let targetDay = calendar.date(byAdding: .day, value: -leadDays, to: start) else { return nil }
        return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: targetDay)
    }
}
