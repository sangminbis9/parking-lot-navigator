import Foundation

/// 캘린더 하단 "가게 이벤트" 섹션용. 축제·공연과 달리 로컬 매장 이벤트(/api/local-events)만 다룬다.
@MainActor
final class StoreEventViewModel: ObservableObject {
    @Published var events: [FreeEvent] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private let radiusMeters = 50_000

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(coordinate: (lat: Double, lng: Double)?) async {
        let lat = coordinate?.lat ?? 37.5665
        let lng = coordinate?.lng ?? 126.9780
        isLoading = true
        errorMessage = nil
        do {
            let loaded = try await apiClient.nearbyEvents(lat: lat, lng: lng, radiusMeters: radiusMeters)
            events = loaded.sorted { $0.startDate < $1.startDate }
        } catch {
            errorMessage = "가게 이벤트를 불러오지 못했습니다."
        }
        isLoading = false
    }

    /// 종료일이 없는 이벤트는 시작일 하루짜리로 본다.
    func eventsForDay(_ day: Date, formatter: DateFormatter) -> [FreeEvent] {
        let dayKey = formatter.string(from: day)
        return events.filter { event in
            let end = event.endDate ?? event.startDate
            return event.startDate <= dayKey && end >= dayKey
        }
    }
}
