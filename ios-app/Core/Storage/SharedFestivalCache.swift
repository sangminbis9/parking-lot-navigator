import Foundation

struct WidgetSnapshot: Codable {
    let generatedAt: Date
    let items: [Festival]
}

enum SharedFestivalCache {
    static let fileName = "widget_festivals.v2.json"

    static func save(_ snapshot: WidgetSnapshot, appGroupID: String) {
        guard let url = containerURL(appGroupID: appGroupID) else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(snapshot) {
            try? data.write(to: url, options: .atomic)
        }
    }

    static func load(appGroupID: String) -> WidgetSnapshot? {
        guard let url = containerURL(appGroupID: appGroupID),
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            let data = try Data(contentsOf: url)
            return try decoder.decode(WidgetSnapshot.self, from: data)
        } catch {
            return nil
        }
    }

    private static func containerURL(appGroupID: String) -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(fileName)
    }
}
