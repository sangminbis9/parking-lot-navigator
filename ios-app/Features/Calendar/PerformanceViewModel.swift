import Foundation

@MainActor
final class PerformanceViewModel: ObservableObject {
    @Published var performances: [PerformanceItem] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private let radiusMeters = 50_000
    private let upcomingWithinDays = 365

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(coordinate: (lat: Double, lng: Double)?) async {
        let fallback = FallbackLocation.resolve()
        let lat = coordinate?.lat ?? fallback.lat
        let lng = coordinate?.lng ?? fallback.lng
        isLoading = true
        errorMessage = nil
        do {
            let result = try await apiClient.nearbyPerformances(
                lat: lat,
                lng: lng,
                radiusMeters: radiusMeters,
                upcomingWithinDays: upcomingWithinDays
            )
            let festivalItems = result.festivals.map { PerformanceItem.festival($0) }
            let eventItems = result.events.map { PerformanceItem.event($0) }
            performances = (festivalItems + eventItems).sorted { $0.startDate < $1.startDate }
        } catch {
            errorMessage = NetworkErrorMessage.text(for: error, subject: "공연 정보")
        }
        isLoading = false
    }

    func performancesForDay(_ day: Date, calendar: Calendar, formatter: DateFormatter) -> [PerformanceItem] {
        let dayKey = formatter.string(from: day)
        return performances.filter { item in
            item.startDate <= dayKey && item.endDate >= dayKey
        }
    }
}
