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
                radiusMeters: filter.radiusMeters,
                upcomingWithinDays: filter.dateRange.upcomingWithinDays,
                pastWithinDays: 90
            )
            await apply(festivals: raw, filter: filter)
            state = .loaded
        } catch {
            state = .failed("축제 정보를 불러오지 못했어요")
        }
    }

    func reapply(filter: FestivalFilter) async {
        await apply(festivals: allFestivals, filter: filter)
    }

    private func apply(festivals: [Festival], filter: FestivalFilter) async {
        allFestivals = festivals
        // 필터링과 날짜 버킷팅은 순수 계산이다. 축제 하나당 기간 일수만큼 DateFormatter를
        // 왕복하므로 메인 액터에서 하면 목록이 클수록 캘린더 탭이 그만큼 멈춘다.
        let bucketed = await Task.detached(priority: .userInitiated) {
            Self.bucket(festivals: festivals.filter { filter.matches($0) })
        }.value
        festivalsByDay = bucketed
    }

    func festivals(on day: Date) -> [Festival] {
        let key = Self.dayFormatter.string(from: day)
        return festivalsByDay[key] ?? []
    }

    /// 백그라운드에서 돌린다. 공유 dayFormatter는 메인에서 festivals(on:)이 쓰고 있으므로
    /// DateFormatter와 Calendar를 이 함수 안에서 따로 만들어 경쟁을 만들지 않는다.
    private nonisolated static func bucket(festivals: [Festival]) -> [String: [Festival]] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        let calendar = Calendar(identifier: .gregorian)

        var result: [String: [Festival]] = [:]
        for festival in festivals {
            guard let start = formatter.date(from: festival.startDate) else { continue }
            let end = formatter.date(from: festival.endDate) ?? start
            var cursor = start
            var safety = 0
            while cursor <= end, safety < 200 {
                let key = formatter.string(from: cursor)
                result[key, default: []].append(festival)
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
                safety += 1
            }
        }
        return result
    }
}
