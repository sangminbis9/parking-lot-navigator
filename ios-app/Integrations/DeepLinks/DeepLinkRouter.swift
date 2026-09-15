import Foundation
import Combine

final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()
    private init() {}

    private(set) var pendingQuery: String?
    @Published var pendingFestival: Festival?
    /// 위젯처럼 Festival 전체를 실어 보낼 수 없는 진입점이 쓰는 id. 앱이 공유 캐시에서 되찾는다.
    @Published var pendingFestivalId: String?
    /// 로컬 이벤트 알림에서 실어 보내는 항목. 축제와 달리 공유 캐시가 없어 전체를 담는다.
    @Published var pendingEvent: FreeEvent?
    /// 서버 푸시가 실어 보내는 로컬 이벤트 id. 상세는 앱이 API로 받아 온다.
    @Published var pendingLocalEventId: String?
    /// 예전 캘린더 탭 URL과의 호환 진입점. 앱은 현재 이벤트 목록으로 연결한다.
    @Published var pendingCalendarAt: Date?
    /// 예전 캘린더 딥링크가 가리키던 날짜. 숨긴 화면 코드를 되살릴 때를 위해 모델은 보존한다.
    var pendingCalendarDay: Date?
    /// 알림을 탭했을 때 여는 알림센터. 값이 바뀌는 것 자체가 여는 신호다.
    /// 알림 진입만 이 경로를 쓰고, URL 딥링크와 앱 안 이동은 예전 그대로 각자 목적지로 간다.
    @Published var pendingNotificationInboxAt: Date?
    /// 알림센터에서 눈에 띄게 할 카드의 `AppNotificationItem.id`. 없으면 목록만 연다.
    var pendingNotificationFocusId: String?

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
