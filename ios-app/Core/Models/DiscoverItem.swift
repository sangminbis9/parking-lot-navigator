import Foundation

enum DiscoverStatus: String, Codable, Hashable {
    case ongoing
    case upcoming

    var displayText: String {
        switch self {
        case .ongoing:
            return "\u{C9C4}\u{D589} \u{C911}"
        case .upcoming:
            return "\u{C608}\u{C815}"
        }
    }
}

enum LocalEventStatus: String, Codable, Hashable {
    case pending
    case approved
    case rejected
    case expired
}

struct Festival: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let description: String?
    let startDate: String
    let endDate: String
    let status: DiscoverStatus
    let venueName: String?
    let address: String
    let lat: Double
    let lng: Double
    let distanceMeters: Int
    let source: String
    let sourceUrl: String?
    let imageUrl: String?
    let imageUrls: [String]
    let tags: [String]
    let primaryCategory: FestivalPrimaryCategory?
    let categoryTags: [String]?
    let admissionFee: String?
    let discountInfo: String?
    let bookingInfo: String?
    let contactPhone: String?
    let ageLimit: String?
    let programInfo: String?
    let organizerName: String?

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, description, startDate, endDate, status, venueName, address
        case lat, lng, distanceMeters, source, sourceUrl, imageUrl, imageUrls, tags
        case primaryCategory, categoryTags
        case admissionFee, discountInfo, bookingInfo, contactPhone, ageLimit, programInfo, organizerName
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        startDate = try c.decode(String.self, forKey: .startDate)
        endDate = try c.decode(String.self, forKey: .endDate)
        status = try c.decode(DiscoverStatus.self, forKey: .status)
        venueName = try c.decodeIfPresent(String.self, forKey: .venueName)
        address = try c.decode(String.self, forKey: .address)
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        distanceMeters = try c.decode(Int.self, forKey: .distanceMeters)
        source = try c.decode(String.self, forKey: .source)
        sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        imageUrls = try c.decodeIfPresent([String].self, forKey: .imageUrls) ?? []
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        if let raw = try c.decodeIfPresent(String.self, forKey: .primaryCategory) {
            primaryCategory = FestivalPrimaryCategory(rawValue: raw)
        } else {
            primaryCategory = nil
        }
        categoryTags = try c.decodeIfPresent([String].self, forKey: .categoryTags)
        admissionFee = try c.decodeIfPresent(String.self, forKey: .admissionFee)
        discountInfo = try c.decodeIfPresent(String.self, forKey: .discountInfo)
        bookingInfo = try c.decodeIfPresent(String.self, forKey: .bookingInfo)
        contactPhone = try c.decodeIfPresent(String.self, forKey: .contactPhone)
        ageLimit = try c.decodeIfPresent(String.self, forKey: .ageLimit)
        programInfo = try c.decodeIfPresent(String.self, forKey: .programInfo)
        organizerName = try c.decodeIfPresent(String.self, forKey: .organizerName)
    }

    init(
        id: String,
        title: String,
        subtitle: String?,
        description: String? = nil,
        startDate: String,
        endDate: String,
        status: DiscoverStatus,
        venueName: String?,
        address: String,
        lat: Double,
        lng: Double,
        distanceMeters: Int,
        source: String,
        sourceUrl: String?,
        imageUrl: String?,
        imageUrls: [String] = [],
        tags: [String],
        primaryCategory: FestivalPrimaryCategory? = nil,
        categoryTags: [String]? = nil,
        admissionFee: String? = nil,
        discountInfo: String? = nil,
        bookingInfo: String? = nil,
        contactPhone: String? = nil,
        ageLimit: String? = nil,
        programInfo: String? = nil,
        organizerName: String? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.description = description
        self.startDate = startDate
        self.endDate = endDate
        self.status = status
        self.venueName = venueName
        self.address = address
        self.lat = lat
        self.lng = lng
        self.distanceMeters = distanceMeters
        self.source = source
        self.sourceUrl = sourceUrl
        self.imageUrl = imageUrl
        self.imageUrls = imageUrls
        self.tags = tags
        self.primaryCategory = primaryCategory
        self.categoryTags = categoryTags
        self.admissionFee = admissionFee
        self.discountInfo = discountInfo
        self.bookingInfo = bookingInfo
        self.contactPhone = contactPhone
        self.ageLimit = ageLimit
        self.programInfo = programInfo
        self.organizerName = organizerName
    }
}

struct FreeEvent: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let eventType: String
    let category: String?
    let sourceId: String?
    let startDate: String
    let endDate: String?
    let status: LocalEventStatus
    let storeName: String
    let venueName: String?
    let address: String
    let lat: Double
    let lng: Double
    let distanceMeters: Int
    let source: String
    let sourceUrl: String?
    let imageUrl: String?
    let imageUrls: [String]
    let benefit: String?
    let shortDescription: String?
    let region: String?
    let updatedAt: String?
    let confidenceScore: Double?
    let needsReview: Bool?
    let isSponsored: Bool
    let sponsorTier: String?
    let paidUntil: String?
    let priorityScore: Int
    let primaryCategory: LocalEventPrimaryCategory?
    let categoryTags: [String]?
    /// 공연(KOPIS) 행은 같은 primaryCategory 필드에 축제 카테고리(music_performance 등)를 담아 보낸다.
    /// LocalEventPrimaryCategory로는 해석되지 않으므로 축제 카테고리로도 한 번 더 읽어 둔다.
    let festivalCategory: FestivalPrimaryCategory?
    let isFree: Bool?
    let price: String?
    let programInfo: String?

    enum CodingKeys: String, CodingKey {
        case id, title, eventType, category, sourceId, startDate, endDate, status
        case storeName, venueName, address, lat, lng, distanceMeters, source, sourceUrl
        case imageUrl, imageUrls, benefit, shortDescription, region, updatedAt, confidenceScore
        case needsReview, isSponsored, sponsorTier, paidUntil, priorityScore
        case primaryCategory, categoryTags, isFree, price, programInfo
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        eventType = try c.decode(String.self, forKey: .eventType)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        sourceId = try c.decodeIfPresent(String.self, forKey: .sourceId)
        startDate = try c.decode(String.self, forKey: .startDate)
        endDate = try c.decodeIfPresent(String.self, forKey: .endDate)
        // /api/performances는 shared-types의 FreeEvent 형태로 응답한다 — storeName이 없고
        // status는 ongoing/upcoming이다. 엄격하게 디코드하면 공연 배열 전체가 통째로 실패한다.
        if let rawStatus = try c.decodeIfPresent(String.self, forKey: .status) {
            status = LocalEventStatus(rawValue: rawStatus) ?? .approved
        } else {
            status = .approved
        }
        storeName = try c.decodeIfPresent(String.self, forKey: .storeName)
            ?? c.decodeIfPresent(String.self, forKey: .venueName)
            ?? title
        venueName = try c.decodeIfPresent(String.self, forKey: .venueName)
        address = try c.decode(String.self, forKey: .address)
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        distanceMeters = try c.decode(Int.self, forKey: .distanceMeters)
        source = try c.decode(String.self, forKey: .source)
        sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        imageUrls = try c.decodeIfPresent([String].self, forKey: .imageUrls) ?? []
        benefit = try c.decodeIfPresent(String.self, forKey: .benefit)
        shortDescription = try c.decodeIfPresent(String.self, forKey: .shortDescription)
        region = try c.decodeIfPresent(String.self, forKey: .region)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        confidenceScore = try c.decodeIfPresent(Double.self, forKey: .confidenceScore)
        needsReview = try c.decodeIfPresent(Bool.self, forKey: .needsReview)
        isSponsored = try c.decodeIfPresent(Bool.self, forKey: .isSponsored) ?? false
        sponsorTier = try c.decodeIfPresent(String.self, forKey: .sponsorTier)
        paidUntil = try c.decodeIfPresent(String.self, forKey: .paidUntil)
        priorityScore = try c.decodeIfPresent(Int.self, forKey: .priorityScore) ?? 0
        if let raw = try c.decodeIfPresent(String.self, forKey: .primaryCategory) {
            primaryCategory = LocalEventPrimaryCategory(rawValue: raw)
            festivalCategory = FestivalPrimaryCategory(rawValue: raw)
        } else {
            primaryCategory = nil
            festivalCategory = nil
        }
        categoryTags = try c.decodeIfPresent([String].self, forKey: .categoryTags)
        isFree = try c.decodeIfPresent(Bool.self, forKey: .isFree)
        price = try c.decodeIfPresent(String.self, forKey: .price)
        programInfo = try c.decodeIfPresent(String.self, forKey: .programInfo)
    }

    init(
        id: String,
        title: String,
        eventType: String,
        category: String?,
        sourceId: String?,
        startDate: String,
        endDate: String?,
        status: LocalEventStatus,
        storeName: String,
        venueName: String?,
        address: String,
        lat: Double,
        lng: Double,
        distanceMeters: Int,
        source: String,
        sourceUrl: String?,
        imageUrl: String?,
        imageUrls: [String] = [],
        benefit: String?,
        shortDescription: String?,
        region: String?,
        updatedAt: String?,
        confidenceScore: Double?,
        needsReview: Bool?,
        isSponsored: Bool,
        sponsorTier: String?,
        paidUntil: String?,
        priorityScore: Int,
        primaryCategory: LocalEventPrimaryCategory? = nil,
        categoryTags: [String]? = nil,
        festivalCategory: FestivalPrimaryCategory? = nil,
        isFree: Bool? = nil,
        price: String? = nil,
        programInfo: String? = nil
    ) {
        self.id = id
        self.title = title
        self.eventType = eventType
        self.category = category
        self.sourceId = sourceId
        self.startDate = startDate
        self.endDate = endDate
        self.status = status
        self.storeName = storeName
        self.venueName = venueName
        self.address = address
        self.lat = lat
        self.lng = lng
        self.distanceMeters = distanceMeters
        self.source = source
        self.sourceUrl = sourceUrl
        self.imageUrl = imageUrl
        self.imageUrls = imageUrls
        self.benefit = benefit
        self.shortDescription = shortDescription
        self.region = region
        self.updatedAt = updatedAt
        self.confidenceScore = confidenceScore
        self.needsReview = needsReview
        self.isSponsored = isSponsored
        self.sponsorTier = sponsorTier
        self.paidUntil = paidUntil
        self.priorityScore = priorityScore
        self.primaryCategory = primaryCategory
        self.categoryTags = categoryTags
        self.festivalCategory = festivalCategory
        self.isFree = isFree
        self.price = price
        self.programInfo = programInfo
    }

    /// 스크랩 이벤트는 본문에서 기간을 못 뽑으면 종료일이 없고 시작일이 수집한 날로 박힌다.
    /// 종료일 대신 시작일로 끝을 판정하면 수집 다음 날부터 전부 "예정"이 되므로 그렇게 하지 않는다.
    /// 서버가 이미 끝난 이벤트(`end_date < 어제`, 종료일 없으면 `start_date < 14일 전`)를 걸러 주므로,
    /// 앱에 온 이벤트는 시작 전인 것만 예정이고 나머지는 진행 중이다.
    var timelineStatus: DiscoverStatus {
        guard status != .expired else { return .upcoming }
        let today = String(Date().formatted(.iso8601.year().month().day()).prefix(10))
        if !startDate.isEmpty && startDate > today {
            return .upcoming
        }
        return .ongoing
    }

    var dateText: String {
        if let endDate, !endDate.isEmpty {
            return "\(startDate) - \(endDate)"
        }
        return startDate
    }
}

struct DiscoverPresentation: Hashable {
    let title: String
    let subtitle: String?
    let description: String?
    let dateText: String
    let venueName: String?
    let address: String
    let status: DiscoverStatus
    let typeText: String
    /// 태그 색을 정하는 분류. `typeText`는 이 값의 표시 이름이다.
    let domain: DiscoverDomain
    let source: String
    let sourceUrl: String?
    let imageUrl: String?
    let imageUrls: [String]
    let price: String?
    let region: String?
    let updatedAt: String?
    let tags: [String]
    let admissionFee: String?
    let discountInfo: String?
    let bookingInfo: String?
    let contactPhone: String?
    let ageLimit: String?
    let programInfo: String?
    let organizerName: String?
    let isFestivalSource: Bool

    /// 목록 썸네일용 대표 이미지. 소스에 따라 `imageUrl`이 비고 `imageUrls`에만 이미지가 오는 행이 있어
    /// 상세 화면(`DiscoverHeroImage`)과 같은 순서로 고른다.
    var primaryImageUrl: String? { imageUrl ?? imageUrls.first }

}

extension Festival {
    /// 목록 썸네일용 대표 이미지. 소스에 따라 `imageUrl`이 비고 `imageUrls`에만 이미지가 오는 행이 있어
    /// 상세 화면(`DiscoverHeroImage`)과 같은 순서로 고른다.
    var primaryImageUrl: String? { imageUrl ?? imageUrls.first }

    var discoverDomain: DiscoverDomain {
        if primaryCategory == .tradeExpo { return .tradeExpo }
        if DiscoverDomain.performanceSources.contains(source) { return .performance }
        // 음악·공연 축제는 지도 공연 레이어에도 들어가는 항목이라 종류도 공연으로 본다.
        // 축제로 두면 이벤트 탭 축제 토글에 공연이 섞여 나온다.
        if primaryCategory == .musicPerformance { return .performance }
        return .festival
    }

    var discoverTags: [String] {
        DiscoverTagBuilder.festivalTags(
            domain: discoverDomain,
            primaryCategory: primaryCategory,
            categoryTags: categoryTags ?? [],
            address: address,
            admissionFee: admissionFee,
            rawTags: tags
        )
    }

    var discoverDestination: Destination {
        Destination(
            id: "festival-\(id)",
            name: title,
            address: address,
            lat: lat,
            lng: lng,
            source: source,
            rawCategory: discoverTags.joined(separator: ","),
            normalizedCategory: "festival"
        )
    }

    var discoverPresentation: DiscoverPresentation {
        DiscoverPresentation(
            title: title,
            subtitle: subtitle,
            description: description ?? subtitle,
            dateText: "\(startDate) - \(endDate)",
            venueName: venueName,
            address: address,
            status: status,
            typeText: discoverDomain.displayName,
            domain: discoverDomain,
            source: source,
            sourceUrl: sourceUrl,
            imageUrl: imageUrl,
            imageUrls: imageUrls,
            price: nil,
            region: nil,
            updatedAt: nil,
            tags: discoverTags,
            admissionFee: admissionFee,
            discountInfo: discountInfo,
            bookingInfo: bookingInfo,
            contactPhone: contactPhone,
            ageLimit: ageLimit,
            programInfo: programInfo,
            organizerName: organizerName,
            isFestivalSource: true
        )
    }
}

extension FreeEvent {
    /// 목록 썸네일용 대표 이미지. 소스에 따라 `imageUrl`이 비고 `imageUrls`에만 이미지가 오는 행이 있어
    /// 상세 화면(`DiscoverHeroImage`)과 같은 순서로 고른다.
    var primaryImageUrl: String? { imageUrl ?? imageUrls.first }

    static func koreanEventType(_ raw: String) -> String {
        switch raw {
        case "discount": return "할인·세일"
        case "freebie": return "무료 증정"
        case "limited_menu", "new_limited": return "신메뉴·한정"
        case "popup": return "팝업·이벤트"
        case "opening", "opening_event": return "오픈 이벤트"
        case "review_event": return "리뷰 이벤트"
        case "seasonal": return "시즌·기념일"
        default: return "이벤트"
        }
    }

    var discoverDomain: DiscoverDomain {
        if DiscoverDomain.performanceSources.contains(source) { return .performance }
        if festivalCategory == .tradeExpo { return .tradeExpo }
        return .localEvent
    }

    var discoverTags: [String] {
        let domain = discoverDomain
        // 가게 이벤트의 benefit("아메리카노 1+1")은 입장료가 아니다. 요금 태그는 공연·박람회에만 단다.
        return DiscoverTagBuilder.eventTags(
            domain: domain,
            primaryCategory: primaryCategory,
            festivalCategory: festivalCategory,
            categoryTags: categoryTags ?? [],
            eventType: eventType,
            address: address,
            feeText: domain == .localEvent ? nil : price,
            isFree: domain == .localEvent ? nil : isFree
        )
    }

    var discoverDestination: Destination {
        Destination(
            id: "event-\(id)",
            name: title,
            address: address,
            lat: lat,
            lng: lng,
            source: source,
            rawCategory: discoverTags.joined(separator: ","),
            normalizedCategory: "event"
        )
    }

    var discoverPresentation: DiscoverPresentation {
        DiscoverPresentation(
            title: title,
            subtitle: benefit ?? storeName,
            description: shortDescription,
            dateText: dateText,
            venueName: venueName ?? storeName,
            address: address,
            status: timelineStatus,
            typeText: discoverDomain.displayName,
            domain: discoverDomain,
            source: source,
            sourceUrl: sourceUrl,
            imageUrl: imageUrl,
            imageUrls: imageUrls,
            price: benefit ?? price,
            region: region,
            updatedAt: updatedAt,
            tags: discoverTags,
            admissionFee: nil,
            discountInfo: nil,
            bookingInfo: nil,
            contactPhone: nil,
            ageLimit: nil,
            programInfo: programInfo,
            organizerName: nil,
            isFestivalSource: false
        )
    }
}

/// 축제 / 공연 / 박람회 / 가게 이벤트를 가르는 단일 기준.
/// 지도 홀로그램 카드와 상세 화면이 같은 태그를 쓰도록 도메인 판정을 여기 한 곳에 모은다.
enum DiscoverDomain {
    case festival
    case performance
    case tradeExpo
    case localEvent

    var displayName: String {
        switch self {
        case .festival: return "축제"
        case .performance: return "공연"
        case .tradeExpo: return "박람회"
        case .localEvent: return "가게 이벤트"
        }
    }

    /// Worker discoveryCache의 PERFORMANCE_EVENT_SOURCES와 같은 목록.
    static let performanceSources: Set<String> = ["kopis"]

    /// 즐겨찾기 저장 모델처럼 카테고리 정보가 없는 축소 모델용 판정. source만으로 가른다.
    static func fromSource(_ source: String, isFestival: Bool) -> DiscoverDomain {
        if performanceSources.contains(source) { return .performance }
        if source == "akei-trade-expo" { return .tradeExpo }
        return isFestival ? .festival : .localEvent
    }
}

enum DiscoverTagBuilder {
    /// 태그 순서는 한눈에 보고 싶은 순서다: 도메인 → 카테고리 → 요금 → 도시 → 세부.
    /// 홀로그램 카드는 앞쪽 몇 개만, 상세 화면은 전부 노출한다.
    static func festivalTags(
        domain: DiscoverDomain,
        primaryCategory: FestivalPrimaryCategory?,
        categoryTags: [String],
        address: String,
        admissionFee: String?,
        rawTags: [String]
    ) -> [String] {
        var tags: [String] = [domain.displayName]
        appendUnique(festivalCategoryTag(primaryCategory, domain: domain), to: &tags)
        appendUnique(feeTag(feeText: admissionFee, isFree: nil), to: &tags)
        appendUnique(cityTag(from: address), to: &tags)
        appendUnique(detailTags(categoryTags + rawTags), to: &tags)
        return Array(tags.prefix(6))
    }

    static func eventTags(
        domain: DiscoverDomain,
        primaryCategory: LocalEventPrimaryCategory?,
        festivalCategory: FestivalPrimaryCategory?,
        categoryTags: [String],
        eventType: String,
        address: String,
        feeText: String?,
        isFree: Bool?
    ) -> [String] {
        var tags: [String] = [domain.displayName]
        if domain == .localEvent {
            appendUnique(localCategoryTag(primaryCategory, eventType: eventType), to: &tags)
        } else {
            appendUnique(festivalCategoryTag(festivalCategory, domain: domain), to: &tags)
        }
        appendUnique(feeTag(feeText: feeText, isFree: isFree), to: &tags)
        appendUnique(cityTag(from: address), to: &tags)
        appendUnique(detailTags(categoryTags), to: &tags)
        return Array(tags.prefix(6))
    }

    /// 도메인 태그와 같은 말을 반복하는 카테고리는 버린다.
    private static func festivalCategoryTag(
        _ category: FestivalPrimaryCategory?,
        domain: DiscoverDomain
    ) -> [String] {
        guard let category else { return [] }
        switch category {
        case .etc, .generalEvent, .tradeExpo:
            return []
        case .musicPerformance where domain == .performance:
            return []
        default:
            return [category.displayName]
        }
    }

    private static func localCategoryTag(
        _ category: LocalEventPrimaryCategory?,
        eventType: String
    ) -> [String] {
        if let category, category != .etc { return [category.displayName] }
        let fallback = FreeEvent.koreanEventType(eventType)
        return fallback == "이벤트" ? [] : [fallback]
    }

    /// 금액이 적혀 있으면 유료, 조건 없는 무료 문구만 있으면 무료, 판별 불가면 태그를 달지 않는다.
    /// "65세 이상 무료"처럼 특정 대상만 무료인 문구는 무료로 치지 않는다 (Worker feeNormalize와 같은 기준).
    private static func feeTag(feeText: String?, isFree: Bool?) -> [String] {
        let raw = (feeText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty {
            return isFree == true ? ["무료"] : []
        }
        let lowered = raw.lowercased()
        if lowered.range(of: "[0-9][0-9,]*\\s*(원|won)", options: .regularExpression) != nil { return ["유료"] }
        if lowered.contains("유료") { return ["유료"] }
        let conditionalMarkers = ["이상", "이하", "미만", "초과", "어린이", "청소년", "경로", "장애", "군인", "학생", "유공자", "동반"]
        let saysFree = lowered.contains("무료") || lowered.contains("free") || lowered.contains("없음")
        if saysFree && !conditionalMarkers.contains(where: { lowered.contains($0) }) { return ["무료"] }
        return []
    }

    /// 주소에서 도시 하나만 뽑는다. 광역시는 그 자체로, 도 단위 주소는 시·군까지 내려간다.
    private static func cityTag(from address: String) -> [String] {
        let tokens = address
            .split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .map(String.init)
            .map { $0.trimmingCharacters(in: .punctuationCharacters) }

        var province: String? = nil
        for token in tokens {
            guard let cleaned = cleanTag(normalizedRegionToken(token)) else { continue }
            if metroCities.contains(cleaned) { return [cleaned] }
            if cleaned.hasSuffix("시") || cleaned.hasSuffix("군") { return [cleaned] }
            if cleaned.hasSuffix("도") && province == nil { province = cleaned }
        }
        return province.map { [$0] } ?? []
    }

    /// 서버가 주는 태그는 한글/영문이 섞여 있다. 사용자에게 보이는 태그는 한글만 남긴다.
    private static func detailTags(_ values: [String]) -> [String] {
        values
            .flatMap { $0.split(whereSeparator: { $0 == "/" || $0 == "," || $0 == "|" }).map(String.init) }
            .compactMap { cleanTag($0) }
            .filter { containsHangul($0) && !isGenericTag($0) }
    }

    private static func containsHangul(_ value: String) -> Bool {
        value.unicodeScalars.contains { $0.value >= 0xAC00 && $0.value <= 0xD7A3 }
    }

    private static let metroCities: Set<String> = [
        "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주"
    ]

    private static func cleanTag(_ value: String) -> String? {
        let trimmed = value
            .replacingOccurrences(of: "#", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("\u{FFFD}") else { return nil }

        let allowedScalars = trimmed.unicodeScalars.filter { scalar in
            CharacterSet.alphanumerics.contains(scalar) || (scalar.value >= 0xAC00 && scalar.value <= 0xD7A3)
        }
        let cleaned = allowedScalars.map(String.init).joined()
        guard cleaned.count >= 2, cleaned.count <= 18 else { return nil }
        return cleaned
    }

    private static func normalizedRegionToken(_ token: String) -> String {
        switch token {
        case "서울특별시": return "서울"
        case "서울시": return "서울"
        case "부산광역시": return "부산"
        case "부산시": return "부산"
        case "대구광역시": return "대구"
        case "대구시": return "대구"
        case "인천광역시": return "인천"
        case "인천시": return "인천"
        case "광주광역시": return "광주"
        case "광주시": return "광주"
        case "대전광역시": return "대전"
        case "대전시": return "대전"
        case "울산광역시": return "울산"
        case "울산시": return "울산"
        case "세종특별자치시": return "세종"
        case "제주특별자치도": return "제주"
        default: return token
        }
    }

    private static func isGenericTag(_ tag: String) -> Bool {
        let lowercased = tag.lowercased()
        let genericTags = Set([
            "축제", "이벤트", "행사", "문화행사", "기타", "무료", "유료",
            "festival", "event", "events", "free", "etc", "other"
        ])
        return genericTags.contains(lowercased)
    }

    private static func appendUnique(_ values: [String], to tags: inout [String]) {
        for value in values where !tags.contains(value) {
            tags.append(value)
        }
    }
}

struct DiscoverFestivalsResponse: Codable {
    let items: [Festival]
    let generatedAt: String
}

struct DiscoverEventsResponse: Codable {
    let items: [FreeEvent]
    let generatedAt: String
}

struct DiscoverFestivalDetailResponse: Decodable {
    let item: Festival
    let generatedAt: String
}

struct DiscoverEventDetailResponse: Decodable {
    let item: FreeEvent
    let generatedAt: String
}

struct DiscoverPerformancesResponse: Decodable {
    let festivals: [Festival]
    let events: [FreeEvent]
    let generatedAt: String
}

enum PerformanceItem: Identifiable {
    case festival(Festival)
    case event(FreeEvent)

    var id: String {
        switch self {
        case .festival(let f): return "perf-festival-\(f.id)"
        case .event(let e): return "perf-event-\(e.id)"
        }
    }

    var presentation: DiscoverPresentation {
        switch self {
        case .festival(let f): return f.discoverPresentation
        case .event(let e): return e.discoverPresentation
        }
    }

    var startDate: String {
        switch self {
        case .festival(let f): return f.startDate
        case .event(let e): return e.startDate
        }
    }

    var endDate: String {
        switch self {
        case .festival(let f): return f.endDate
        case .event(let e): return e.endDate ?? e.startDate
        }
    }

    var lat: Double {
        switch self {
        case .festival(let f): return f.lat
        case .event(let e): return e.lat
        }
    }

    var lng: Double {
        switch self {
        case .festival(let f): return f.lng
        case .event(let e): return e.lng
        }
    }

    var discoverDestination: Destination {
        switch self {
        case .festival(let f): return f.discoverDestination
        case .event(let e): return e.discoverDestination
        }
    }
}

enum MapExploreMode: String, CaseIterable, Identifiable {
    case parking
    case festivals
    case events

    var id: String { rawValue }

    var title: String {
        switch self {
        case .parking: return "\u{C8FC}\u{CC28}"
        case .festivals: return "\u{CD95}\u{C81C}"
        case .events: return "\u{C774}\u{BCA4}\u{D2B8}"
        }
    }
}
