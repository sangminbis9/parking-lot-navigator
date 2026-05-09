import Foundation

enum DiscoverStatus: String, Codable, Hashable {
    case ongoing
    case upcoming
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
