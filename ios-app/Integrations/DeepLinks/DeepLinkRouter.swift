import Foundation
import Combine

final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()
    private init() {}

    private(set) var pendingQuery: String?
    @Published var pendingFestival: Festival?

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

    func handle(_ url: URL) {
        guard url.scheme == "parkingnavigator" else { return }
        if url.host == "search" {
            pendingQuery = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "q" })?
                .value
        }
    }
}
