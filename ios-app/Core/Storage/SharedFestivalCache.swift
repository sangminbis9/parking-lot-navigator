import Foundation

/// 위젯 캐시를 어떤 기준으로 모았는지. 위젯이 "내 주변 / 지역 / 전국"을 구분해 표기하고,
/// 결과가 비었을 때 원인(위치 없음 vs 필터 조건)을 가르는 데 쓴다.
enum WidgetBasisKind: String, Codable {
    case location
    case region
    case nationwide
}

struct WidgetSnapshot: Codable {
    let generatedAt: Date
    let items: [Festival]
    let basisKind: WidgetBasisKind
    /// 화면에 그대로 노출하는 기준 라벨. "내 주변", "서울·부산", "전국".
    let basisLabel: String
    /// 앱 필터가 기본값에서 벗어나 있는지. 빈 결과 문구를 가른다.
    let hasActiveFilter: Bool

    init(
        generatedAt: Date,
        items: [Festival],
        basisKind: WidgetBasisKind = .location,
        basisLabel: String = "내 주변",
        hasActiveFilter: Bool = false
    ) {
        self.generatedAt = generatedAt
        self.items = items
        self.basisKind = basisKind
        self.basisLabel = basisLabel
        self.hasActiveFilter = hasActiveFilter
    }

    // 기준 필드가 없던 예전 캐시 파일도 그대로 읽히게 한다. 앱 업데이트 직후 첫 sync 전까지
    // 위젯이 통째로 비어 보이는 것을 막는 목적이다.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decode(Date.self, forKey: .generatedAt)
        items = try c.decodeIfPresent([Festival].self, forKey: .items) ?? []
        basisKind = try c.decodeIfPresent(WidgetBasisKind.self, forKey: .basisKind) ?? .location
        basisLabel = try c.decodeIfPresent(String.self, forKey: .basisLabel) ?? "내 주변"
        hasActiveFilter = try c.decodeIfPresent(Bool.self, forKey: .hasActiveFilter) ?? false
    }
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
