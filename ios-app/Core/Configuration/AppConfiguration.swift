import Foundation

struct AppConfiguration {
    let apiBaseURL: URL
    let appGroupID: String
    let kakaoNativeAppKey: String
    let navigationProvider: String

    static var current: AppConfiguration {
        let info = Bundle.main.infoDictionary ?? [:]
        let apiBase = (info["API_BASE_URL"] as? String).flatMap(URL.init(string:)) ?? URL(string: "http://localhost:4000")!
        return AppConfiguration(
            apiBaseURL: apiBase,
            appGroupID: info["APP_GROUP_ID"] as? String ?? "group.com.example.ParkingLotNavigator",
            kakaoNativeAppKey: info["KAKAO_NATIVE_APP_KEY"] as? String ?? "",
            navigationProvider: info["NAVIGATION_PROVIDER"] as? String ?? "mock"
        )
    }
}
