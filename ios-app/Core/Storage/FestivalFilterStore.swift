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
        if !statuses.isEmpty, !statuses.contains(festival.status) { return false }
        if !regions.isEmpty {
            let selectedProvinces = regions.filter { Self.koreanRegions.contains($0) }
            let selectedCities = regions.filter { !Self.koreanRegions.contains($0) }
            var matched = false
            if !selectedProvinces.isEmpty {
                let tags = festival.discoverTags.filter { Self.koreanRegions.contains($0) }
                if tags.contains(where: { selectedProvinces.contains($0) }) { matched = true }
            }
            if !matched, !selectedCities.isEmpty {
                if selectedCities.contains(where: { festival.address.contains($0) }) { matched = true }
            }
            if !matched { return false }
        }
        if !primaryCategories.isEmpty {
            guard let category = festival.primaryCategory, primaryCategories.contains(category) else { return false }
        }
        return true
    }

    // 17개 광역시도 단축명 (태그 기반 매칭)
    static let koreanRegions: Set<String> = [
        "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
        "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"
    ]

    // 광역시도 → 하위 도시/구 계층. 키는 address.contains() 매칭에 사용.
    static let regionHierarchy: [(name: String, cities: [String])] = [
        ("서울", ["강남구", "강동구", "강서구", "관악구", "광진구", "노원구", "마포구",
                  "서초구", "성동구", "성북구", "송파구", "영등포구", "용산구", "은평구", "종로구", "중구"]),
        ("부산", ["강서구", "금정구", "기장군", "남구", "동구", "동래구", "북구",
                  "사하구", "서구", "수영구", "연제구", "영도구", "중구", "해운대구"]),
        ("대구", ["남구", "달서구", "달성군", "동구", "북구", "서구", "수성구", "중구"]),
        ("인천", ["강화군", "계양구", "남동구", "동구", "미추홀구", "부평구", "서구", "연수구", "옹진군", "중구"]),
        ("광주", ["광산구", "남구", "동구", "북구", "서구"]),
        ("대전", ["대덕구", "동구", "서구", "유성구", "중구"]),
        ("울산", ["남구", "동구", "북구", "울주군", "중구"]),
        ("세종", []),
        ("경기", ["가평군", "고양시", "과천시", "광명시", "광주시", "구리시", "군포시",
                  "김포시", "남양주시", "동두천시", "부천시", "성남시", "수원시", "시흥시",
                  "안산시", "안성시", "안양시", "양주시", "양평군", "여주시", "연천군",
                  "오산시", "용인시", "의왕시", "의정부시", "이천시", "파주시", "평택시",
                  "포천시", "하남시", "화성시"]),
        ("강원", ["강릉시", "고성군", "동해시", "삼척시", "속초시", "양구군", "양양군",
                  "영월군", "원주시", "인제군", "정선군", "철원군", "춘천시", "태백시",
                  "평창군", "홍천군", "화천군", "횡성군"]),
        ("충북", ["괴산군", "단양군", "보은군", "영동군", "옥천군", "음성군", "제천시",
                  "증평군", "진천군", "청주시", "충주시"]),
        ("충남", ["계룡시", "공주시", "금산군", "논산시", "당진시", "보령시", "부여군",
                  "서산시", "서천군", "아산시", "예산군", "천안시", "청양군", "태안군", "홍성군"]),
        ("전북", ["고창군", "군산시", "김제시", "남원시", "무주군", "부안군", "순창군",
                  "완주군", "익산시", "임실군", "장수군", "전주시", "정읍시", "진안군"]),
        ("전남", ["강진군", "고흥군", "곡성군", "광양시", "구례군", "나주시", "담양군",
                  "목포시", "무안군", "보성군", "순천시", "신안군", "여수시", "영광군",
                  "영암군", "완도군", "장성군", "장흥군", "진도군", "함평군", "해남군", "화순군"]),
        ("경북", ["경산시", "경주시", "고령군", "구미시", "군위군", "김천시", "문경시",
                  "봉화군", "상주시", "성주군", "안동시", "영덕군", "영양군", "영주시",
                  "영천시", "예천군", "울릉군", "울진군", "의성군", "청도군", "청송군", "칠곡군", "포항시"]),
        ("경남", ["거제시", "거창군", "고성군", "김해시", "남해군", "밀양시", "사천시",
                  "산청군", "양산시", "의령군", "진주시", "창녕군", "창원시", "통영시",
                  "하동군", "함안군", "함양군", "합천군"]),
        ("제주", ["서귀포시", "제주시"])
    ]

    // 도시명에서 행정 접미사(시·군·구)를 제거한 표시 이름.
    // 방향 접미사(남·동·서·북·중)는 구별을 위해 접미사 유지.
    static func cityDisplayName(_ key: String) -> String {
        let ambiguousSingleChar = ["남", "동", "서", "북", "중"]
        for suffix in ["시", "군", "구"] {
            if key.hasSuffix(suffix), key.count > 2 {
                let stripped = String(key.dropLast())
                if suffix == "구", ambiguousSingleChar.contains(stripped) { return key }
                return stripped
            }
        }
        return key
    }

    static let allCityNames: Set<String> = Set(regionHierarchy.flatMap(\.cities))

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
