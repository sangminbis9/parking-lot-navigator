import Foundation
import Combine

@MainActor
final class CalendarViewModel: ObservableObject {
    enum LoadState {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    @Published private(set) var state: LoadState = .idle
    @Published private(set) var festivalsByDay: [String: [Festival]] = [:]
    @Published private(set) var allFestivals: [Festival] = []

    private let apiClient: APIClientProtocol
    private let calendar = Calendar(identifier: .gregorian)

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        return formatter
    }()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(coordinate: (lat: Double, lng: Double)?, filter: FestivalFilter) async {
        state = .loading
        let coord = coordinate ?? (lat: 37.5663, lng: 126.9779)
        do {
            let raw = try await apiClient.nearbyFestivals(
                lat: coord.lat,
                lng: coord.lng,
                radiusMeters: filter.radiusMeters
            )
            apply(festivals: raw, filter: filter)
            state = .loaded
        } catch {
            state = .failed("축제 정보를 불러오지 못했어요")
        }
    }

    func reapply(filter: FestivalFilter) {
        apply(festivals: allFestivals, filter: filter)
    }

    private func apply(festivals: [Festival], filter: FestivalFilter) {
        allFestivals = festivals
        let filtered = festivals.filter { filter.matches($0) }
        festivalsByDay = bucket(festivals: filtered)
    }

    func festivals(on day: Date) -> [Festival] {
        let key = Self.dayFormatter.string(from: day)
        return festivalsByDay[key] ?? []
    }

    private func bucket(festivals: [Festival]) -> [String: [Festival]] {
        var result: [String: [Festival]] = [:]
        for festival in festivals {
            guard let start = Self.dayFormatter.date(from: festival.startDate) else { continue }
            let end = Self.dayFormatter.date(from: festival.endDate) ?? start
            var cursor = start
            var safety = 0
            while cursor <= end, safety < 200 {
                let key = Self.dayFormatter.string(from: cursor)
                result[key, default: []].append(festival)
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
                safety += 1
            }
        }
        return result
    }
}
