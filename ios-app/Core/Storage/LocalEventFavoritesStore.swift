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
    // 저장 목록 카드가 검색 탭 목록과 같은 썸네일을 쓰도록 함께 보관한다.
    let imageUrl: String?

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
        self.imageUrl = event.primaryImageUrl
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
        self.imageUrl = presentation.primaryImageUrl
    }
}

extension SavedEvent {
    /// 저장 목록용 폴백 FreeEvent. 저장 시점의 최소 필드만으로 구성한다(상세 필드는 없음).
    var asEvent: FreeEvent {
        FreeEvent(
            id: id,
            title: title,
            eventType: eventType,
            category: nil,
            sourceId: nil,
            startDate: startDate,
            endDate: endDate,
            status: .approved,
            storeName: storeName,
            venueName: storeName,
            address: address,
            lat: lat,
            lng: lng,
            distanceMeters: 0,
            source: source,
            sourceUrl: nil,
            imageUrl: imageUrl,
            benefit: nil,
            shortDescription: nil,
            region: nil,
            updatedAt: nil,
            confidenceScore: nil,
            needsReview: nil,
            isSponsored: false,
            sponsorTier: nil,
            paidUntil: nil,
            priorityScore: 0
        )
    }

    /// 저장 목록에서 상세 화면으로 이동할 때 사용할 최소 Destination/Presentation.
    var destination: Destination {
        Destination(
            id: "event-\(id)",
            name: title,
            address: address,
            lat: lat,
            lng: lng,
            source: source,
            rawCategory: "",
            normalizedCategory: "event"
        )
    }

    var presentation: DiscoverPresentation {
        // 저장 모델에는 카테고리·요금이 없다. 도메인과 도시만이라도 상세 화면과 같은 규칙으로 만든다.
        let domain = DiscoverDomain.fromSource(source, isFestival: false)
        let tags = DiscoverTagBuilder.eventTags(
            domain: domain,
            primaryCategory: nil,
            festivalCategory: nil,
            categoryTags: [],
            eventType: eventType,
            address: address,
            feeText: nil,
            isFree: nil
        )
        return DiscoverPresentation(
            title: title,
            subtitle: storeName,
            description: nil,
            dateText: (endDate.map { $0 == startDate ? startDate : "\(startDate) - \($0)" }) ?? startDate,
            venueName: storeName,
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
            isFestivalSource: false
        )
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
