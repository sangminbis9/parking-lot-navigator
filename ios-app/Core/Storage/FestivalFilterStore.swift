import Foundation

struct FestivalFilter: Codable, Hashable {
    var regions: [String]
    var radiusKm: Int?
    var primaryCategories: Set<FestivalPrimaryCategory>
    var statuses: [DiscoverStatus]

    static let allRadiusOptions: [Int] = [10, 20, 50]
    static let `default` = FestivalFilter(regions: [], radiusKm: 50, primaryCategories: [], statuses: [])

    var radiusMeters: Int {
        guard let radiusKm else { return 200_000 }
        return radiusKm * 1_000
    }

    var isEmpty: Bool {
        regions.isEmpty && primaryCategories.isEmpty && statuses.isEmpty && radiusKm == FestivalFilter.default.radiusKm
    }

    func matches(_ festival: Festival) -> Bool {
        if !statuses.isEmpty, !statuses.contains(festival.status) {
            return false
        }
        if !regions.isEmpty {
            let festivalRegions = festival.discoverTags.filter { Self.koreanRegions.contains($0) }
            if festivalRegions.isEmpty || !regions.contains(where: { festivalRegions.contains($0) }) {
                return false
            }
        }
        if !primaryCategories.isEmpty {
            guard let category = festival.primaryCategory, primaryCategories.contains(category) else {
                return false
            }
        }
        return true
    }

    static let koreanRegions: Set<String> = [
        "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
        "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"
    ]

    enum CodingKeys: String, CodingKey {
        case regions, radiusKm, primaryCategories, statuses
    }

    init(regions: [String], radiusKm: Int?, primaryCategories: Set<FestivalPrimaryCategory>, statuses: [DiscoverStatus]) {
        self.regions = regions
        self.radiusKm = radiusKm
        self.primaryCategories = primaryCategories
        self.statuses = statuses
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        regions = try c.decodeIfPresent([String].self, forKey: .regions) ?? []
        radiusKm = try c.decodeIfPresent(Int.self, forKey: .radiusKm)
        primaryCategories = try c.decodeIfPresent(Set<FestivalPrimaryCategory>.self, forKey: .primaryCategories) ?? []
        statuses = try c.decodeIfPresent([DiscoverStatus].self, forKey: .statuses) ?? []
    }
}

enum FestivalFilterStore {
    private static let keyPrefix = "festivalFilter"

    static func key(for scope: String) -> String {
        "\(keyPrefix).\(scope)"
    }

    static func load(scope: String, appGroupID: String) -> FestivalFilter {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key(for: scope)),
              let filter = try? JSONDecoder().decode(FestivalFilter.self, from: data) else {
            return .default
        }
        return filter
    }

    static func save(_ filter: FestivalFilter, scope: String, appGroupID: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(filter) else { return }
        defaults.set(data, forKey: key(for: scope))
    }
}
