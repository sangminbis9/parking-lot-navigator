import Combine
import Foundation

/// 앱 안 알림센터의 저장소.
///
/// 서버에 기기별 inbox 테이블을 두지 않고 기기 저장소에 남긴다.
/// producer 셋 중 둘(저장한 축제 리마인더, 새 로컬 이벤트 알림)이 서버가 알지 못하는
/// 기기 로컬 알림이라 서버 inbox로는 절반밖에 못 덮고, 기기 × 알림마다 행을 쌓으면
/// 2026-09-01부터 강제되는 D1 무료 쓰기 한도(하루 100,000행)를 알림센터 하나가 다시 먹는다.
final class NotificationInboxStore: ObservableObject {
    static let shared = NotificationInboxStore()

    /// 오래된 회차와 무한정 늘어나는 목록을 함께 막는다.
    private static let maxItems = 200
    private static let retentionDays = 30

    private let defaults: UserDefaults
    private let key = "notificationInbox.items"

    @Published private(set) var items: [AppNotificationItem] = []

    var unreadCount: Int { items.filter { !$0.isRead }.count }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: key),
           let decoded = try? JSONDecoder().decode([AppNotificationItem].self, from: data) {
            items = decoded
        }
    }

    /// 알림이 실제로 도착했을 때만 부른다. 같은 회차가 다시 오면 카드를 하나 더 만들지 않고
    /// 있던 카드를 갱신하며 다시 안 읽음으로 돌린다.
    func ingest(_ incoming: [AppNotificationItem]) {
        guard !incoming.isEmpty else { return }
        var next = items
        for item in incoming {
            if let index = next.firstIndex(where: { $0.id == item.id }) {
                var existing = next[index]
                existing.notificationKind = item.notificationKind
                if !item.title.isEmpty { existing.title = item.title }
                if let venue = item.venueName { existing.venueName = venue }
                if let image = item.imageUrl { existing.imageUrl = image }
                existing.receivedAt = item.receivedAt
                existing.isRead = false
                next[index] = existing
            } else {
                next.append(item)
            }
        }
        persist(prune(next))
    }

    func markRead(id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }), !items[index].isRead else { return }
        var next = items
        next[index].isRead = true
        persist(next)
    }

    func markAllRead() {
        guard unreadCount > 0 else { return }
        persist(items.map { item in
            var updated = item
            updated.isRead = true
            return updated
        })
    }

    /// 상세를 받아 온 뒤 스냅샷을 최신 값으로 덮는다. 다음 실행에서 첫 화면이 더 정확해진다.
    func updateSnapshot(id: String, title: String, venueName: String?, imageUrl: String?) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        var next = items
        if !title.isEmpty { next[index].title = title }
        if let venueName { next[index].venueName = venueName }
        if let imageUrl { next[index].imageUrl = imageUrl }
        guard next[index] != items[index] else { return }
        persist(next)
    }

    func remove(id: String) {
        guard items.contains(where: { $0.id == id }) else { return }
        persist(items.filter { $0.id != id })
    }

    private func prune(_ input: [AppNotificationItem]) -> [AppNotificationItem] {
        // occurrenceDate는 "yyyy-MM-dd"라 문자열 비교로 날짜 비교가 된다.
        let cutoff = Self.dayFormatter.string(
            from: Calendar.current.date(byAdding: .day, value: -Self.retentionDays, to: Date()) ?? Date()
        )
        let kept = input.filter { $0.occurrenceDate.isEmpty || $0.occurrenceDate >= cutoff }
        guard kept.count > Self.maxItems else { return kept }
        return Array(kept.sorted { $0.receivedAt > $1.receivedAt }.prefix(Self.maxItems))
    }

    private func persist(_ next: [AppNotificationItem]) {
        items = next
        defaults.set(try? JSONEncoder().encode(next), forKey: key)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
