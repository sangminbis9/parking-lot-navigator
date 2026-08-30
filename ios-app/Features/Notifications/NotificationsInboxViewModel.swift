import Combine
import Foundation

/// 알림센터 한 줄. 보관함 스냅샷으로 먼저 그리고, 상세를 받아 오면 그 값으로 덮는다.
struct NotificationsInboxRow: Identifiable {
    let item: AppNotificationItem
    var festival: Festival?
    var event: FreeEvent?
    /// 상세 조회가 끝났는데도 행사를 찾지 못했다 — 삭제됐거나 더 이상 공개되지 않는다.
    var isUnavailable: Bool = false

    var id: String { item.id }
    var title: String {
        let resolved = festival?.title ?? event?.title ?? ""
        return resolved.isEmpty ? item.title : resolved
    }
    var venueName: String? {
        festival?.venueName ?? event?.venueName ?? event?.storeName ?? item.venueName
    }
    var imageUrl: String? {
        festival?.primaryImageUrl ?? event?.primaryImageUrl ?? item.imageUrl
    }
    var startDate: String { festival?.startDate ?? event?.startDate ?? item.occurrenceDate }
    var endDate: String? { festival?.endDate ?? event?.endDate }
    /// 카드에서 상세로 넘어갈 수 있는지. 스냅샷만 있고 상세를 못 받아 왔으면 넘어가지 않는다.
    var canOpenDetail: Bool { festival != nil || event != nil }
}

@MainActor
final class NotificationsInboxViewModel: ObservableObject {
    @Published private(set) var rows: [NotificationsInboxRow] = []

    private let apiClient: APIClientProtocol
    private let store: NotificationInboxStore
    private let appGroupID: String
    private var resolvedIds = Set<String>()
    private var cancellable: AnyCancellable?

    init(
        apiClient: APIClientProtocol,
        store: NotificationInboxStore = .shared,
        appGroupID: String = AppConfiguration.current.appGroupID
    ) {
        self.apiClient = apiClient
        self.store = store
        self.appGroupID = appGroupID
        rows = Self.sorted(store.items.map { NotificationsInboxRow(item: $0) })
        cancellable = store.$items
            .receive(on: DispatchQueue.main)
            .sink { [weak self] items in self?.merge(items) }
    }

    var unreadCount: Int { store.unreadCount }

    /// 화면에 들어올 때 부른다. 스냅샷은 이미 그려져 있고, 여기서는 아직 못 채운 행만 받아 온다.
    func resolveMissing() async {
        let pending = rows.filter { !resolvedIds.contains($0.id) }
        guard !pending.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            for row in pending {
                group.addTask { [weak self] in await self?.resolve(row.item) }
            }
        }
    }

    func markRead(id: String) { store.markRead(id: id) }
    func markAllRead() { store.markAllRead() }

    private func resolve(_ item: AppNotificationItem) async {
        resolvedIds.insert(item.id)
        if item.isFestival {
            // 위젯 캐시에 이미 있으면 네트워크를 타지 않는다.
            if let cached = SharedFestivalCache.load(appGroupID: appGroupID)?
                .items
                .first(where: { $0.id == item.eventId }) {
                apply(id: item.id) { $0.festival = cached }
                return
            }
            if let festival = try? await apiClient.festival(id: item.eventId) {
                apply(id: item.id) { $0.festival = festival }
                store.updateSnapshot(
                    id: item.id,
                    title: festival.title,
                    venueName: festival.venueName,
                    imageUrl: festival.primaryImageUrl
                )
            } else {
                apply(id: item.id) { $0.isUnavailable = true }
            }
            return
        }
        if let event = try? await apiClient.localEvent(id: item.eventId) {
            apply(id: item.id) { $0.event = event }
            store.updateSnapshot(
                id: item.id,
                title: event.title,
                venueName: event.venueName ?? event.storeName,
                imageUrl: event.primaryImageUrl
            )
        } else {
            apply(id: item.id) { $0.isUnavailable = true }
        }
    }

    private func apply(id: String, _ change: (inout NotificationsInboxRow) -> Void) {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
        change(&rows[index])
        rows = Self.sorted(rows)
    }

    /// 보관함이 바뀌면(새 알림·읽음 처리) 이미 받아 온 상세는 유지한 채 목록만 맞춘다.
    private func merge(_ items: [AppNotificationItem]) {
        let existing = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
        rows = Self.sorted(items.map { item in
            guard var row = existing[item.id] else { return NotificationsInboxRow(item: item) }
            row = NotificationsInboxRow(
                item: item,
                festival: row.festival,
                event: row.event,
                isUnavailable: row.isUnavailable
            )
            return row
        })
    }

    /// 시작일 오름차순, 같으면 최근에 받은 알림이 위. 안 읽음이라고 위로 끌어올리지 않는다.
    private static func sorted(_ rows: [NotificationsInboxRow]) -> [NotificationsInboxRow] {
        let today = NotificationsInboxFormat.today()
        return rows
            // 이미 끝난 행사는 목록에서 내린다. 날짜를 못 읽는 행은 남긴다.
            .filter { row in
                guard let end = row.endDate, !end.isEmpty else { return true }
                return end >= today
            }
            .sorted { lhs, rhs in
                if lhs.startDate != rhs.startDate { return lhs.startDate < rhs.startDate }
                return lhs.item.receivedAt > rhs.item.receivedAt
            }
    }
}

/// 알림센터가 쓰는 날짜 표기. 저장 형식은 어디서나 "yyyy-MM-dd"다.
enum NotificationsInboxFormat {
    static func today() -> String { dayFormatter.string(from: Date()) }

    /// "오늘" / "D-1" / "D-7". 날짜를 못 읽으면 nil.
    static func dDay(from day: String) -> String? {
        guard let date = dayFormatter.date(from: day) else { return nil }
        let calendar = Calendar.seoul
        let start = calendar.startOfDay(for: Date())
        guard let days = calendar.dateComponents([.day], from: start, to: date).day else { return nil }
        if days == 0 { return "오늘" }
        return days > 0 ? "D-\(days)" : nil
    }

    /// "8월 31일" 또는 기간이 있으면 "8월 31일 – 9월 2일".
    static func dateText(start: String, end: String?) -> String? {
        guard let startDate = dayFormatter.date(from: start) else { return nil }
        let startText = displayFormatter.string(from: startDate)
        guard let end, end != start, let endDate = dayFormatter.date(from: end) else { return startText }
        return "\(startText) – \(displayFormatter.string(from: endDate))"
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "M월 d일"
        return formatter
    }()
}
