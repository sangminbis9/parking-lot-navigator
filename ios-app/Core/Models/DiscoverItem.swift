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
    let tags: [String]
    let primaryCategory: FestivalPrimaryCategory?
    let categoryTags: [String]?

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, startDate, endDate, status, venueName, address
        case lat, lng, distanceMeters, source, sourceUrl, imageUrl, tags
        case primaryCategory, categoryTags
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        subtitle = try c.decodeIfPresent(String.self, forKey: .subtitle)
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
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        if let raw = try c.decodeIfPresent(String.self, forKey: .primaryCategory) {
            primaryCategory = FestivalPrimaryCategory(rawValue: raw)
        } else {
            primaryCategory = nil
        }
        categoryTags = try c.decodeIfPresent([String].self, forKey: .categoryTags)
    }

    init(
        id: String,
        title: String,
        subtitle: String?,
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
        tags: [String],
        primaryCategory: FestivalPrimaryCategory? = nil,
        categoryTags: [String]? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
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
        self.tags = tags
        self.primaryCategory = primaryCategory
        self.categoryTags = categoryTags
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

    enum CodingKeys: String, CodingKey {
        case id, title, eventType, category, sourceId, startDate, endDate, status
        case storeName, venueName, address, lat, lng, distanceMeters, source, sourceUrl
        case imageUrl, benefit, shortDescription, region, updatedAt, confidenceScore
        case needsReview, isSponsored, sponsorTier, paidUntil, priorityScore
        case primaryCategory, categoryTags
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
        status = try c.decode(LocalEventStatus.self, forKey: .status)
        storeName = try c.decode(String.self, forKey: .storeName)
        venueName = try c.decodeIfPresent(String.self, forKey: .venueName)
        address = try c.decode(String.self, forKey: .address)
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        distanceMeters = try c.decode(Int.self, forKey: .distanceMeters)
        source = try c.decode(String.self, forKey: .source)
        sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
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
        } else {
            primaryCategory = nil
        }
        categoryTags = try c.decodeIfPresent([String].self, forKey: .categoryTags)
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
        categoryTags: [String]? = nil
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
    }

    var timelineStatus: DiscoverStatus {
        guard status != .expired else { return .upcoming }
        let today = String(Date().formatted(.iso8601.year().month().day()).prefix(10))
        if startDate <= today && (endDate ?? startDate) >= today {
            return .ongoing
        }
        return .upcoming
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
    let source: String
    let sourceUrl: String?
    let imageUrl: String?
    let price: String?
    let region: String?
    let updatedAt: String?
    let tags: [String]
}

extension Festival {
    var discoverTags: [String] {
        DiscoverTagBuilder.festivalTags(
            primaryCategory: primaryCategory,
            categoryTags: categoryTags ?? [],
            address: address,
            startDate: startDate,
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
            description: subtitle,
            dateText: "\(startDate) - \(endDate)",
            venueName: venueName,
            address: address,
            status: status,
            typeText: "\u{CD95}\u{C81C}",
            source: source,
            sourceUrl: sourceUrl,
            imageUrl: imageUrl,
            price: nil,
            region: nil,
            updatedAt: nil,
            tags: discoverTags
        )
    }
}

extension FreeEvent {
    var discoverTags: [String] {
        DiscoverTagBuilder.eventTags(
            primaryCategory: primaryCategory,
            categoryTags: categoryTags ?? [],
            eventType: eventType,
            address: address,
            startDate: startDate
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
            typeText: eventType.isEmpty ? "\u{C774}\u{BCA4}\u{D2B8}" : eventType,
            source: source,
            sourceUrl: sourceUrl,
            imageUrl: imageUrl,
            price: benefit,
            region: region,
            updatedAt: updatedAt,
            tags: discoverTags
        )
    }
}

enum DiscoverTagBuilder {
    static func festivalTags(
        primaryCategory: FestivalPrimaryCategory?,
        categoryTags: [String],
        address: String,
        startDate: String,
        rawTags: [String]
    ) -> [String] {
        var tags: [String] = []
        if let primaryCategory {
            appendUnique([primaryCategory.displayName], to: &tags)
        }
        appendUnique(categoryTags.compactMap { cleanTag($0) }, to: &tags)
        appendUnique(rawTags.compactMap { cleanTag($0) }.filter { !isGenericTag($0) }, to: &tags)
        appendUnique(regionTags(from: address), to: &tags)
        appendUnique(timeTags(startDate: startDate), to: &tags)
        return Array(tags.prefix(8))
    }

    static func eventTags(
        primaryCategory: LocalEventPrimaryCategory?,
        categoryTags: [String],
        eventType: String,
        address: String,
        startDate: String
    ) -> [String] {
        var tags: [String] = []
        if let primaryCategory {
            appendUnique([primaryCategory.displayName], to: &tags)
        }
        appendUnique(categoryTags.compactMap { cleanTag($0) }, to: &tags)
        if let eventTag = cleanTag(eventType), !isGenericTag(eventTag) {
            appendUnique([eventTag], to: &tags)
        }
        appendUnique(regionTags(from: address), to: &tags)
        appendUnique(timeTags(startDate: startDate), to: &tags)
        return Array(tags.prefix(8))
    }

    private static func regionTags(from address: String) -> [String] {
        let tokens = address
            .split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .map(String.init)
            .map { $0.trimmingCharacters(in: .punctuationCharacters) }

        var tags: [String] = []
        for token in tokens {
            let normalized = normalizedRegionToken(token)
            guard let cleaned = cleanTag(normalized), !cleaned.isEmpty else { continue }
            if isRegionTag(cleaned) {
                appendUnique([cleaned], to: &tags)
            }
            if tags.count >= 2 { break }
        }
        return tags
    }

    private static func timeTags(startDate: String) -> [String] {
        var tags: [String] = []
        if let month = month(from: startDate) {
            appendUnique(["\(month)월", seasonTag(for: month)], to: &tags)
        }
        return tags
    }

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

    private static func isRegionTag(_ tag: String) -> Bool {
        let shortCities = Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주"])
        return shortCities.contains(tag) || tag.hasSuffix("도") || tag.hasSuffix("시") || tag.hasSuffix("구") || tag.hasSuffix("군")
    }

    private static func month(from date: String) -> Int? {
        let parts = date.split(separator: "-")
        guard parts.count >= 2 else { return nil }
        return Int(parts[1])
    }

    private static func seasonTag(for month: Int) -> String {
        switch month {
        case 3...5: return "봄"
        case 6...8: return "여름"
        case 9...11: return "가을"
        default: return "겨울"
        }
    }

    private static func isGenericTag(_ tag: String) -> Bool {
        let lowercased = tag.lowercased()
        let genericTags = Set(["축제", "이벤트", "행사", "festival", "event", "events", "free", "무료", "문화행사"])
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
