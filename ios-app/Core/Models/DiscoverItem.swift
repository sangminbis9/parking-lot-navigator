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
}

struct DiscoverPresentation: Hashable {
    let title: String
    let subtitle: String?
    let dateText: String
    let venueName: String?
    let address: String
    let status: DiscoverStatus
    let typeText: String
    let source: String
    let imageUrl: String?
    let tags: [String]
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
