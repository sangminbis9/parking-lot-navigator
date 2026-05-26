import Foundation

struct LocalEventFilter: Codable, Hashable {
    var regions: [String]
    var radiusKm: Int?
    var primaryCategories: Set<LocalEventPrimaryCategory>
    var statuses: [DiscoverStatus]
    var includeSponsored: Bool

    static let allRadiusOptions: [Int] = [10, 20, 50]
    static let `default` = LocalEventFilter(
        regions: [],
        radiusKm: 50,
        primaryCategories: [],
        statuses: [],
        includeSponsored: true
    )

    var radiusMeters: Int {
        guard let radiusKm else { return 200_000 }
        return radiusKm * 1_000
    }

    var isEmpty: Bool {
        regions.isEmpty
            && primaryCategories.isEmpty
            && statuses.isEmpty
            && radiusKm == LocalEventFilter.default.radiusKm
            && includeSponsored
    }

    func matches(_ event: FreeEvent) -> Bool {
        if !includeSponsored, event.isSponsored {
            return false
        }
        if !statuses.isEmpty, !statuses.contains(event.timelineStatus) {
            return false
        }
        if !regions.isEmpty {
            let eventRegions = event.discoverTags.filter { FestivalFilter.koreanRegions.contains($0) }
            if eventRegions.isEmpty || !regions.contains(where: { eventRegions.contains($0) }) {
                return false
            }
        }
        if !primaryCategories.isEmpty {
            guard let category = event.primaryCategory, primaryCategories.contains(category) else {
                return false
            }
        }
        return true
    }

    enum CodingKeys: String, CodingKey {
        case regions, radiusKm, primaryCategories, statuses, includeSponsored
    }

    init(
        regions: [String],
        radiusKm: Int?,
        primaryCategories: Set<LocalEventPrimaryCategory>,
        statuses: [DiscoverStatus],
        includeSponsored: Bool
    ) {
        self.regions = regions
        self.radiusKm = radiusKm
        self.primaryCategories = primaryCategories
        self.statuses = statuses
        self.includeSponsored = includeSponsored
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        regions = try c.decodeIfPresent([String].self, forKey: .regions) ?? []
        radiusKm = try c.decodeIfPresent(Int.self, forKey: .radiusKm)
        primaryCategories = try c.decodeIfPresent(Set<LocalEventPrimaryCategory>.self, forKey: .primaryCategories) ?? []
        statuses = try c.decodeIfPresent([DiscoverStatus].self, forKey: .statuses) ?? []
        includeSponsored = try c.decodeIfPresent(Bool.self, forKey: .includeSponsored) ?? true
    }
}

enum LocalEventFilterStore {
    private static let keyPrefix = "localEventFilter"

    static func key(for scope: String) -> String {
        "\(keyPrefix).\(scope)"
    }

    static func load(scope: String, appGroupID: String) -> LocalEventFilter {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key(for: scope)),
              let filter = try? JSONDecoder().decode(LocalEventFilter.self, from: data) else {
            return .default
        }
        return filter
    }

    static func save(_ filter: LocalEventFilter, scope: String, appGroupID: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(filter) else { return }
        defaults.set(data, forKey: key(for: scope))
    }
}

@MainActor
final class LocalEventFilterModel: ObservableObject {
    @Published var filter: LocalEventFilter

    private let scope: String
    private let appGroupID: String

    init(scope: String, appGroupID: String) {
        self.scope = scope
        self.appGroupID = appGroupID
        self.filter = LocalEventFilterStore.load(scope: scope, appGroupID: appGroupID)
    }

    func update(_ newFilter: LocalEventFilter) {
        filter = newFilter
        LocalEventFilterStore.save(newFilter, scope: scope, appGroupID: appGroupID)
    }
}
