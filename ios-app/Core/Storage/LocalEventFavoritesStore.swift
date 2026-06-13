import Foundation
import Combine

struct SavedEvent: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let eventType: String
    let startDate: String
    let endDate: String?
    let storeName: String
    let address: String
    let lat: Double
    let lng: Double
    let source: String

    init(event: FreeEvent) {
        self.id = event.id
        self.title = event.title
        self.eventType = event.eventType
        self.startDate = event.startDate
        self.endDate = event.endDate
        self.storeName = event.storeName
        self.address = event.address
        self.lat = event.lat
        self.lng = event.lng
        self.source = event.source
    }

    init(destination: Destination, presentation: DiscoverPresentation) {
        let rawId = destination.id.hasPrefix("event-") ? String(destination.id.dropFirst("event-".count)) : destination.id
        self.id = rawId
        self.title = presentation.title
        self.eventType = presentation.typeText
        self.startDate = presentation.dateText.components(separatedBy: " - ").first ?? ""
        self.endDate = presentation.dateText.components(separatedBy: " - ").last
        self.storeName = presentation.venueName ?? ""
        self.address = presentation.address
        self.lat = destination.lat
        self.lng = destination.lng
        self.source = presentation.source
    }
}

@MainActor
final class LocalEventFavoritesStore: ObservableObject {
    @Published private(set) var saved: [SavedEvent]

    private let appGroupID: String
    private static let key = "localEventFavorites"

    init(appGroupID: String) {
        self.appGroupID = appGroupID
        self.saved = Self.load(appGroupID: appGroupID)
    }

    func contains(id: String) -> Bool {
        saved.contains { $0.id == id }
    }

    @discardableResult
    func toggle(_ event: FreeEvent) -> Bool {
        if let idx = saved.firstIndex(where: { $0.id == event.id }) {
            saved.remove(at: idx)
            persist()
            return false
        }
        saved.append(SavedEvent(event: event))
        persist()
        return true
    }

    @discardableResult
    func toggle(_ savedEvent: SavedEvent) -> Bool {
        if let idx = saved.firstIndex(where: { $0.id == savedEvent.id }) {
            saved.remove(at: idx)
            persist()
            return false
        }
        saved.append(savedEvent)
        persist()
        return true
    }

    func remove(id: String) {
        saved.removeAll { $0.id == id }
        persist()
    }

    private func persist() {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(saved) else { return }
        defaults.set(data, forKey: Self.key)
    }

    private static func load(appGroupID: String) -> [SavedEvent] {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key),
              let items = try? JSONDecoder().decode([SavedEvent].self, from: data) else {
            return []
        }
        return items
    }
}
