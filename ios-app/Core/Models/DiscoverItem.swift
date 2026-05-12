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
}

struct FreeEvent: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let eventType: String
    let category: String?
    let sourceId: String?
    let startDate: String
    let endDate: String
    let status: DiscoverStatus
    let isFree: Bool
    let venueName: String?
    let address: String
    let lat: Double
    let lng: Double
    let distanceMeters: Int
    let source: String
    let sourceUrl: String?
    let imageUrl: String?
    let shortDescription: String?
    let price: String?
    let region: String?
    let updatedAt: String?
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
            title: title,
            subtitle: subtitle,
            venueName: venueName,
            address: address,
            startDate: startDate,
            source: source,
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
            title: title,
            eventType: eventType,
            description: shortDescription,
            venueName: venueName,
            address: address,
            startDate: startDate,
            source: source
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
            subtitle: shortDescription,
            description: shortDescription,
            dateText: "\(startDate) - \(endDate)",
            venueName: venueName,
            address: address,
            status: status,
            typeText: eventType.isEmpty ? "\u{C774}\u{BCA4}\u{D2B8}" : eventType,
            source: source,
            sourceUrl: sourceUrl,
            imageUrl: imageUrl,
            price: price,
            region: region,
            updatedAt: updatedAt,
            tags: discoverTags
        )
    }
}

enum DiscoverTagBuilder {
    static func festivalTags(
        title: String,
        subtitle: String?,
        venueName: String?,
        address: String,
        startDate: String,
        source: String,
        rawTags: [String]
    ) -> [String] {
        buildTags(
            title: title,
            category: nil,
            description: subtitle,
            venueName: venueName,
            address: address,
            startDate: startDate,
            source: source,
            rawTags: rawTags
        )
    }

    static func eventTags(
        title: String,
        eventType: String,
        description: String?,
        venueName: String?,
        address: String,
        startDate: String,
        source: String
    ) -> [String] {
        buildTags(
            title: title,
            category: eventType,
            description: description,
            venueName: venueName,
            address: address,
            startDate: startDate,
            source: source,
            rawTags: []
        )
    }

    private static func buildTags(
        title: String,
        category: String?,
        description: String?,
        venueName: String?,
        address: String,
        startDate: String,
        source: String,
        rawTags: [String]
    ) -> [String] {
        var tags: [String] = []
        let searchableText = [title, category, description, venueName, address, source, rawTags.joined(separator: " ")]
            .compactMap { $0 }
            .joined(separator: " ")

        appendUnique(inferredGenreTags(from: searchableText), to: &tags)
        appendUnique(cleanedCategoryTags(from: [category].compactMap { $0 } + rawTags), to: &tags)
        appendUnique(regionTags(from: address), to: &tags)
        appendUnique(timeTags(startDate: startDate, text: searchableText), to: &tags)

        if let organizerTag = organizerTag(from: source) {
            appendUnique([organizerTag], to: &tags)
        }

        return Array(tags.prefix(8))
    }

    private static func inferredGenreTags(from text: String) -> [String] {
        let lowercased = text.lowercased()
        let rules: [(String, [String])] = [
            ("음악", ["음악", "뮤직", "콘서트", "재즈", "클래식", "버스킹", "music", "concert", "jazz"]),
            ("영화", ["영화", "시네마", "film", "movie", "cinema"]),
            ("전시", ["전시", "미술", "아트", "갤러리", "exhibition", "exhibit"]),
            ("푸드", ["푸드", "먹거리", "음식", "맥주", "와인", "커피", "food", "beer", "wine", "coffee"]),
            ("빛", ["빛", "라이트", "조명", "불빛", "등불", "달빛", "light"]),
            ("불꽃", ["불꽃", "불꽃놀이", "firework"]),
            ("꽃", ["꽃", "벚꽃", "장미", "튤립", "국화", "flower", "blossom"]),
            ("전통문화", ["전통", "문화재", "한복", "민속", "heritage", "traditional"]),
            ("마켓", ["마켓", "시장", "플리마켓", "장터", "market"]),
            ("체험", ["체험", "워크숍", "클래스", "workshop", "class"]),
            ("공연", ["공연", "연극", "무용", "퍼포먼스", "performance", "theater"]),
            ("스포츠", ["스포츠", "마라톤", "러닝", "sport", "marathon"]),
            ("책", ["책", "도서", "문학", "북페어", "book", "literature"]),
            ("가족", ["가족", "어린이", "키즈", "family", "kids"])
        ]
        return rules.compactMap { tag, keywords in
            keywords.contains(where: { lowercased.contains($0.lowercased()) }) ? tag : nil
        }
    }

    private static func cleanedCategoryTags(from rawTags: [String]) -> [String] {
        rawTags.compactMap { normalizedCategoryTag($0) }.filter { !isGenericTag($0) }
    }

    private static func normalizedCategoryTag(_ value: String) -> String? {
        let lowercased = value.lowercased()
        let translated: String?
        switch lowercased {
        case "exhibition", "exhibit", "art":
            translated = "전시"
        case "concert", "music", "jazz":
            translated = "음악"
        case "performance", "theater":
            translated = "공연"
        case "market":
            translated = "마켓"
        case "sport", "sports", "marathon":
            translated = "스포츠"
        case "food", "beer", "wine", "coffee":
            translated = "푸드"
        case "festival", "event", "events", "free":
            translated = nil
        default:
            translated = value
        }
        return translated.flatMap { cleanTag($0) }
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

    private static func timeTags(startDate: String, text: String) -> [String] {
        var tags: [String] = []
        if let month = month(from: startDate) {
            appendUnique(["\(month)월", seasonTag(for: month)], to: &tags)
        }

        let lowercased = text.lowercased()
        if ["야간", "밤", "나이트", "달빛", "불빛", "조명", "라이트", "night", "light"].contains(where: { lowercased.contains($0) }) {
            appendUnique(["야간"], to: &tags)
        }
        if ["주말", "토요일", "일요일", "weekend"].contains(where: { lowercased.contains($0.lowercased()) }) {
            appendUnique(["주말"], to: &tags)
        }
        return tags
    }

    private static func organizerTag(from source: String) -> String? {
        if source.contains("서울") || source.contains("열린데이터") {
            return "서울시"
        }
        if source.localizedCaseInsensitiveContains("culture") || source.contains("문화") {
            return "문화포털"
        }
        if source.localizedCaseInsensitiveContains("data.go.kr") || source.contains("공공데이터") {
            return nil
        }
        guard let cleaned = cleanTag(source), !isGenericTag(cleaned) else { return nil }
        if ["mock", "provider", "datagokr", "data", "api", "kakao", "local"].contains(cleaned.lowercased()) {
            return nil
        }
        return cleaned
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
