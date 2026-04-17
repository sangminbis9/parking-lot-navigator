import Foundation

struct AppConfiguration {
    let apiBaseURL: URL
    let appGroupID: String
    let kakaoNativeAppKey: String
    let navigationProvider: String

    static var current: AppConfiguration {
        let info = Bundle.main.infoDictionary ?? [:]
        let apiBaseString = (info["API_BASE_URL"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let apiBase = URL(string: normalizedAPIBaseURLString(apiBaseString)).flatMap { url -> URL? in
            guard url.scheme == "https", url.host != nil else { return nil }
            return url
        } ?? URL(string: "https://parking-lot-navigator-api.parkingnav.workers.dev")!
        return AppConfiguration(
            apiBaseURL: apiBase,
            appGroupID: info["APP_GROUP_ID"] as? String ?? "group.com.example.ParkingLotNavigator",
            kakaoNativeAppKey: info["KAKAO_NATIVE_APP_KEY"] as? String ?? "",
            navigationProvider: info["NAVIGATION_PROVIDER"] as? String ?? "mock"
        )
    }

    private static func normalizedAPIBaseURLString(_ value: String) -> String {
        if value.hasPrefix("https:/"), !value.hasPrefix("https://") {
            return "https://" + value.dropFirst("https:/".count)
        }
        if value.hasPrefix("http:/"), !value.hasPrefix("http://") {
            return "http://" + value.dropFirst("http:/".count)
        }
        return value
    }
}
