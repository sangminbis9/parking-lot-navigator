import Foundation

enum FestivalDateRange: String, Codable, CaseIterable {
    case ongoingOnly
    case oneMonth
    case twoMonths
    case threeMonths
    case sixMonths
    case oneYear
    case custom

    var upcomingWithinDays: Int {
        switch self {
        case .ongoingOnly: return 365
        case .oneMonth: return 30
        case .twoMonths: return 60
        case .threeMonths: return 90
        case .sixMonths: return 180
        case .oneYear, .custom: return 365
        }
    }

    var displayLabel: String {
        switch self {
        case .ongoingOnly: return "진행중"
        case .oneMonth: return "1개월 이내"
        case .twoMonths: return "2개월 이내"
        case .threeMonths: return "3개월 이내"
        case .sixMonths: return "6개월 이내"
        case .oneYear: return "1년 이내"
        case .custom: return "날짜 직접 선택"
        }
    }
}

struct FestivalFilter: Codable, Hashable {
    var regions: [String]
    var primaryCategories: Set<FestivalPrimaryCategory>
    var dateRange: FestivalDateRange
    var customFromDate: String?
    var customToDate: String?

    static let `default` = FestivalFilter(
        regions: [], primaryCategories: [],
        dateRange: .ongoingOnly, customFromDate: nil, customToDate: nil
    )

    /// 거리 반경은 더 이상 사용자가 고르지 않는다. 예전 "전국" 선택과 같은 값으로 항상 조회한다.
    var radiusMeters: Int { 200_000 }

    var isEmpty: Bool {
        regions.isEmpty && primaryCategories.isEmpty
            && dateRange == .ongoingOnly
    }

    func matches(_ festival: Festival) -> Bool {
        switch dateRange {
        case .ongoingOnly:
            if festival.status != .ongoing { return false }
        case .custom:
            if let from = customFromDate, let to = customToDate {
                if festival.startDate > to { return false }
                if festival.endDate < from { return false }
            }
        default:
            break
        }
        if !regions.isEmpty {
            let selectedProvinces = regions.filter { Self.koreanRegions.contains($0) }
            let selectedCities = regions.filter { !Self.koreanRegions.contains($0) }
            var matched = false
            if !selectedProvinces.isEmpty {
                if let province = Self.province(from: festival.address), selectedProvinces.contains(province) { matched = true }
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

    // 태그에는 도시 하나("고양시")만 들어가 도 단위 선택과 맞지 않는다.
    // 주소 앞머리에서 17개 광역시도 단축명을 직접 뽑는다. "경기도 고양시" → "경기".
    static func province(from address: String) -> String? {
        guard let head = address.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) else { return nil }
        for (long, short) in provinceAliases where head.hasPrefix(long) { return short }
        return koreanRegions.first { head.hasPrefix($0) }
    }

    // 단축명이 앞머리에 없는 옛 표기만 따로 매핑한다.
    // 서울특별시·경기도·강원특별자치도·제주특별자치도 등은 hasPrefix로 이미 잡힌다.
    private static let provinceAliases: [(String, String)] = [
        ("충청북도", "충북"), ("충청남도", "충남"),
        ("전라북도", "전북"), ("전라남도", "전남"),
        ("경상북도", "경북"), ("경상남도", "경남")
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
        case regions, primaryCategories, dateRange, customFromDate, customToDate
    }

    init(regions: [String], primaryCategories: Set<FestivalPrimaryCategory>,
         dateRange: FestivalDateRange, customFromDate: String?, customToDate: String?) {
        self.regions = regions
        self.primaryCategories = primaryCategories
        self.dateRange = dateRange
        self.customFromDate = customFromDate
        self.customToDate = customToDate
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        regions = try c.decodeIfPresent([String].self, forKey: .regions) ?? []
        primaryCategories = try c.decodeIfPresent(Set<FestivalPrimaryCategory>.self, forKey: .primaryCategories) ?? []
        dateRange = try c.decodeIfPresent(FestivalDateRange.self, forKey: .dateRange) ?? .ongoingOnly
        customFromDate = try c.decodeIfPresent(String.self, forKey: .customFromDate)
        customToDate = try c.decodeIfPresent(String.self, forKey: .customToDate)
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
