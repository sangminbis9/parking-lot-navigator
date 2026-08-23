import Combine
import Foundation

/// 지도 검색에서 열어본 행사·가게 이벤트 기록. 검색어가 비어 있을 때 카드로 다시 보여준다.
/// 표시에 필요한 필드가 화면마다 달라 축소 모델 대신 원본을 그대로 보관한다.
enum RecentDiscoverEntry: Codable, Identifiable {
    case festival(Festival)
    case event(FreeEvent)

    var id: String {
        switch self {
        case .festival(let festival): return "festival-\(festival.id)"
        case .event(let event): return "event-\(event.id)"
        }
    }
}

final class RecentDiscoverStore: ObservableObject {
    @Published private(set) var entries: [RecentDiscoverEntry]

    private static let key = "recentDiscoverItems"
    private static let limit = 20
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.entries = Self.load(from: defaults)
    }

    func add(_ entry: RecentDiscoverEntry) {
        var updated = entries.filter { $0.id != entry.id }
        updated.insert(entry, at: 0)
        entries = Array(updated.prefix(Self.limit))
        persist()
    }

    func remove(id: String) {
        entries.removeAll { $0.id == id }
        persist()
    }

    func clear() {
        entries = []
        persist()
    }

    private func persist() {
        defaults.set(try? JSONEncoder().encode(entries), forKey: Self.key)
    }

    private static func load(from defaults: UserDefaults) -> [RecentDiscoverEntry] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([RecentDiscoverEntry].self, from: data)) ?? []
    }
}
