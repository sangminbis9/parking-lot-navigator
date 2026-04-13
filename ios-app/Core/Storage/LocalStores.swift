import Foundation
import Combine

final class DestinationStore: ObservableObject {
    @Published private(set) var recents: [Destination] = []
    @Published private(set) var favorites: [Destination] = []

    private let recentsKey = "recentDestinations"
    private let favoritesKey = "favoriteDestinations"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        recents = load(recentsKey)
        favorites = load(favoritesKey)
    }

    func addRecent(_ destination: Destination) {
        recents.removeAll { $0.id == destination.id }
        recents.insert(destination, at: 0)
        recents = Array(recents.prefix(20))
        save(recents, key: recentsKey)
    }

    func toggleFavorite(_ destination: Destination) {
        if favorites.contains(where: { $0.id == destination.id }) {
            favorites.removeAll { $0.id == destination.id }
        } else {
            favorites.insert(destination, at: 0)
        }
        save(favorites, key: favoritesKey)
    }

    private func load(_ key: String) -> [Destination] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Destination].self, from: data)) ?? []
    }

    private func save(_ items: [Destination], key: String) {
        defaults.set(try? JSONEncoder().encode(items), forKey: key)
    }
}

struct SharedDestinationDraft: Codable {
    let text: String
    let receivedAt: Date
}

enum SharedDestinationStore {
    static let key = "sharedDestinationDraft"

    static func save(_ draft: SharedDestinationDraft, appGroupID: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(draft) else { return }
        defaults.set(data, forKey: key)
    }

    static func consume(appGroupID: String) -> SharedDestinationDraft? {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key),
              let draft = try? JSONDecoder().decode(SharedDestinationDraft.self, from: data) else { return nil }
        defaults.removeObject(forKey: key)
        return draft
    }
}
