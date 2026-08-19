import Foundation
import Combine

final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()
    private init() {}

    private(set) var pendingQuery: String?
    @Published var pendingFestival: Festival?
    /// 위젯처럼 Festival 전체를 실어 보낼 수 없는 진입점이 쓰는 id. 앱이 공유 캐시에서 되찾는다.
    @Published var pendingFestivalId: String?
    /// 캘린더 탭으로만 보내는 진입점(위젯 "전체 보기"). 값이 바뀌는 것 자체가 신호다.
    @Published var pendingCalendarAt: Date?

    func urlForDestinationSearch(_ query: String) -> URL {
        var components = URLComponents()
        components.scheme = "parkingnavigator"
        components.host = "search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return components.url!
    }

    func urlForDestination(id: String) -> URL {
        var components = URLComponents()
        components.scheme = "parkingnavigator"
        components.host = "discover"
        components.queryItems = [URLQueryItem(name: "id", value: id)]
        return components.url!
    }

    func urlForCalendar() -> URL {
        var components = URLComponents()
        components.scheme = "parkingnavigator"
        components.host = "calendar"
        return components.url!
    }

    func handle(_ url: URL) {
        guard url.scheme == "parkingnavigator" else { return }
        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        switch url.host {
        case "search":
            pendingQuery = queryItems?.first(where: { $0.name == "q" })?.value
        case "discover":
            pendingFestivalId = queryItems?.first(where: { $0.name == "id" })?.value
        case "calendar":
            pendingCalendarAt = Date()
        default:
            break
        }
    }
}
