import SwiftUI
import KakaoMapsSDK
import KakaoSDKCommon

@main
struct ParkingLotNavigatorApp: App {
    @StateObject private var destinationStore = DestinationStore()
    private let apiClient: APIClientProtocol = APIClient()

    init() {
        let appKey = AppConfiguration.current.kakaoNativeAppKey
        if !appKey.isEmpty {
            SDKInitializer.InitSDK(appKey: appKey)
            KakaoSDK.initSDK(appKey: appKey)
        }
    }

    var body: some Scene {
        WindowGroup {
            AppRootView(apiClient: apiClient)
                .environmentObject(destinationStore)
                .onOpenURL { url in
                    DeepLinkRouter.shared.handle(url)
                }
        }
    }
}
