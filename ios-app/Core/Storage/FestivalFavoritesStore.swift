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
    // 저장 목록 카드가 검색 탭 목록과 같은 썸네일을 쓰도록 함께 보관한다.
    let imageUrl: String?

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
        self.imageUrl = festival.imageUrl
    }

    init(destination: Destination, presentation: DiscoverPresentation) {
        let rawId = destination.id.hasPrefix("festival-") ? String(destination.id.dropFirst("festival-".count)) : destination.id
        let parts = presentation.dateText.components(separatedBy: " - ")
        self.id = rawId
        self.title = presentation.title
        self.startDate = parts.first ?? ""
        self.endDate = parts.last ?? parts.first ?? ""
        self.venueName = presentation.venueName
        self.address = presentation.address
        self.lat = destination.lat
        self.lng = destination.lng
        self.source = presentation.source
        self.imageUrl = presentation.imageUrl
    }
}

extension SavedFestival {
    /// 캘린더 어젠다용 폴백 Festival. 현재 위치·필터 기준 근처 축제 목록에 없는 즐겨찾기도
    /// 어젠다에 표시하기 위해, 캐시된 최소 필드만으로 구성한다(상세 필드는 정보 없음으로 표시됨).
    var asFestival: Festival {
        let today = String(Date().formatted(.iso8601.year().month().day()).prefix(10))
        let status: DiscoverStatus = (startDate <= today && endDate >= today) ? .ongoing : .upcoming
        return Festival(
            id: id,
            title: title,
            subtitle: venueName,
            startDate: startDate,
            endDate: endDate,
            status: status,
            venueName: venueName,
            address: address,
            lat: lat,
            lng: lng,
            distanceMeters: 0,
            source: source,
            sourceUrl: nil,
            imageUrl: imageUrl,
            tags: []
        )
    }

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
        // 저장 모델에는 카테고리·요금이 없다. 도메인과 도시만이라도 상세 화면과 같은 규칙으로 만든다.
        let domain = DiscoverDomain.fromSource(source, isFestival: true)
        let tags = DiscoverTagBuilder.festivalTags(
            domain: domain,
            primaryCategory: nil,
            categoryTags: [],
            address: address,
            admissionFee: nil,
            rawTags: []
        )
        return DiscoverPresentation(
            title: title,
            subtitle: venueName,
            description: nil,
            dateText: startDate == endDate ? startDate : "\(startDate) - \(endDate)",
            venueName: venueName,
            address: address,
            status: .upcoming,
            typeText: domain.displayName,
            source: source,
            sourceUrl: nil,
            imageUrl: imageUrl,
            imageUrls: [],
            price: nil,
            region: nil,
            updatedAt: nil,
            tags: tags,
            admissionFee: nil,
            discountInfo: nil,
            bookingInfo: nil,
            contactPhone: nil,
            ageLimit: nil,
            programInfo: nil,
            organizerName: nil,
            isFestivalSource: true
        )
    }
}

@MainActor
final class FestivalFavoritesStore: ObservableObject {
    @Published private(set) var saved: [SavedFestival]

    private let appGroupID: String
    private static let key = "festivalFavorites"

    // 이 파일은 공유 확장(Share/Widget) 타깃도 컴파일한다. 그쪽은 Core/Services를 안 보므로
    // 알림 서비스를 직접 참조하지 않고, 앱 타깃에서만 실제 동작을 주입한다.
    private let onSave: @MainActor (SavedFestival) -> Void
    private let onRemove: @MainActor (String) -> Void

    init(
        appGroupID: String,
        onSave: @escaping @MainActor (SavedFestival) -> Void = { _ in },
        onRemove: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.appGroupID = appGroupID
        self.onSave = onSave
        self.onRemove = onRemove
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
            onRemove(festival.id)
            return false
        }
        let newSaved = SavedFestival(festival: festival)
        saved.append(newSaved)
        persist()
        onSave(newSaved)
        return true
    }

    @discardableResult
    func toggle(_ savedFestival: SavedFestival) -> Bool {
        if let idx = saved.firstIndex(where: { $0.id == savedFestival.id }) {
            saved.remove(at: idx)
            persist()
            onRemove(savedFestival.id)
            return false
        }
        saved.append(savedFestival)
        persist()
        onSave(savedFestival)
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
