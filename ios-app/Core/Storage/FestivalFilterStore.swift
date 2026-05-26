import Foundation

struct FestivalFilter: Codable, Hashable {
    var regions: [String]
    var radiusKm: Int?
    var tags: [String]
    var statuses: [DiscoverStatus]

    static let allRadiusOptions: [Int] = [10, 20, 50]
    static let `default` = FestivalFilter(regions: [], radiusKm: 50, tags: [], statuses: [])

    var radiusMeters: Int {
        guard let radiusKm else { return 200_000 }
        return radiusKm * 1_000
    }

    var isEmpty: Bool {
        regions.isEmpty && tags.isEmpty && statuses.isEmpty && radiusKm == FestivalFilter.default.radiusKm
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
        if !tags.isEmpty {
            let festivalTags = Set(festival.discoverTags)
            if !tags.contains(where: { festivalTags.contains($0) }) {
                return false
            }
        }
        return true
    }

    static let koreanRegions: Set<String> = [
        "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
        "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"
    ]

    static let availableTagOptions: [String] = [
        "음악", "공연", "전시", "푸드", "꽃", "불꽃", "빛", "전통문화",
        "마켓", "체험", "스포츠", "책", "가족"
    ]
}

enum FestivalFilterStore {
    static let key = "festivalFilter"

    static func load(appGroupID: String) -> FestivalFilter {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key),
              let filter = try? JSONDecoder().decode(FestivalFilter.self, from: data) else {
            return .default
        }
        return filter
    }

    static func save(_ filter: FestivalFilter, appGroupID: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(filter) else { return }
        defaults.set(data, forKey: key)
    }
}
