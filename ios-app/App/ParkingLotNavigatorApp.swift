import SwiftUI
import KakaoMapsSDK
import KakaoSDKCommon

@main
struct ParkingLotNavigatorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var destinationStore = DestinationStore()
    @StateObject private var themeStore = FestivalThemeStore()
    @StateObject private var festivalSync: FestivalSyncService
    @StateObject private var notificationPrefs: NotificationPreferencesModel
    @StateObject private var discoveryService: DiscoveryNotificationService
    @StateObject private var festivalFavorites: FestivalFavoritesStore
    @StateObject private var eventFavorites: LocalEventFavoritesStore
    private let apiClient: APIClientProtocol = APIClient()

    init() {
        let appKey = AppConfiguration.current.kakaoNativeAppKey
        if !appKey.isEmpty {
            SDKInitializer.InitSDK(appKey: appKey)
            KakaoSDK.initSDK(appKey: appKey)
        }
        let client = APIClient()
        let appGroupID = AppConfiguration.current.appGroupID
        _festivalSync = StateObject(wrappedValue: FestivalSyncService(
            apiClient: client,
            appGroupID: appGroupID
        ))
        _notificationPrefs = StateObject(wrappedValue: NotificationPreferencesModel(appGroupID: appGroupID))
        _discoveryService = StateObject(wrappedValue: DiscoveryNotificationService(
            apiClient: client,
            appGroupID: appGroupID
        ))
        _festivalFavorites = StateObject(wrappedValue: FestivalFavoritesStore(appGroupID: appGroupID))
        _eventFavorites = StateObject(wrappedValue: LocalEventFavoritesStore(appGroupID: appGroupID))
    }

    var body: some Scene {
        WindowGroup {
            AppRootView(apiClient: apiClient)
                .environmentObject(destinationStore)
                .environmentObject(themeStore)
                .environmentObject(festivalSync)
                .environmentObject(notificationPrefs)
                .environmentObject(discoveryService)
                .environmentObject(festivalFavorites)
                .environmentObject(eventFavorites)
                .onOpenURL { url in
                    DeepLinkRouter.shared.handle(url)
                }
        }
        .backgroundTask(.appRefresh(DiscoveryNotificationService.refreshTaskID)) {
            await discoveryService.runDiscovery()
            await discoveryService.scheduleNextRefresh()
        }
    }
}
