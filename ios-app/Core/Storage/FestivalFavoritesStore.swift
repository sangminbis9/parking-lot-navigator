import Foundation
import Combine

/// 사용자가 저장(즐겨찾기)한 축제. 캘린더 어젠다·저장 목록·리마인더에 필요한 최소 필드만 보관한다.
struct SavedFestival: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let startDate: String
    let endDate: String
    let venueName: String?
    let address: String
    let lat: Double
    let lng: Double
    let source: String

    init(festival: Festival) {
        self.id = festival.id
        self.title = festival.title
        self.startDate = festival.startDate
        self.endDate = festival.endDate
        self.venueName = festival.venueName
        self.address = festival.address
        self.lat = festival.lat
        self.lng = festival.lng
        self.source = festival.source
    }
}

extension SavedFestival {
    /// 저장 목록에서 상세 화면으로 이동할 때 사용할 최소 Destination/Presentation.
    var destination: Destination {
        Destination(
            id: "festival-\(id)",
            name: title,
            address: address,
            lat: lat,
            lng: lng,
            source: source,
            rawCategory: "",
            normalizedCategory: "festival"
        )
    }

    var presentation: DiscoverPresentation {
        DiscoverPresentation(
            title: title,
            subtitle: venueName,
            description: nil,
            dateText: startDate == endDate ? startDate : "\(startDate) - \(endDate)",
            venueName: venueName,
            address: address,
            status: .upcoming,
            typeText: "\u{CD95}\u{C81C}",
            source: source,
            sourceUrl: nil,
            imageUrl: nil,
            imageUrls: [],
            price: nil,
            region: nil,
            updatedAt: nil,
            tags: []
        )
    }
}

@MainActor
final class FestivalFavoritesStore: ObservableObject {
    @Published private(set) var saved: [SavedFestival]

    private let appGroupID: String
    private static let key = "festivalFavorites"

    init(appGroupID: String) {
        self.appGroupID = appGroupID
        self.saved = Self.load(appGroupID: appGroupID)
    }

    func contains(id: String) -> Bool {
        saved.contains { $0.id == id }
    }

    /// 저장 토글. 추가되면 true, 제거되면 false를 반환한다.
    @discardableResult
    func toggle(_ festival: Festival) -> Bool {
        if let idx = saved.firstIndex(where: { $0.id == festival.id }) {
            saved.remove(at: idx)
            persist()
            return false
        }
        saved.append(SavedFestival(festival: festival))
        persist()
        return true
    }

    func remove(id: String) {
        saved.removeAll { $0.id == id }
        persist()
    }

    /// 해당 날짜(yyyy-MM-dd) 범위에 걸치는 저장 축제가 하나라도 있는지.
    func hasSaved(onDayKey dayKey: String) -> Bool {
        saved.contains { $0.startDate <= dayKey && dayKey <= $0.endDate }
    }

    private func persist() {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(saved) else { return }
        defaults.set(data, forKey: Self.key)
    }

    private static func load(appGroupID: String) -> [SavedFestival] {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key),
              let items = try? JSONDecoder().decode([SavedFestival].self, from: data) else {
            return []
        }
        return items
    }
}
