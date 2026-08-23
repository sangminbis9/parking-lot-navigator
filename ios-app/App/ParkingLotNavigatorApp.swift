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
    @StateObject private var reminderService: FestivalReminderService
    @StateObject private var festivalFavorites: FestivalFavoritesStore
    @StateObject private var eventFavorites: LocalEventFavoritesStore
    private let apiClient: APIClientProtocol = APIClient()

    init() {
        // 메인 스레드가 100ms 이상 붙잡히면 콘솔에 남긴다. 성능 회귀를 기기에서 바로 확인하는 용도.
        MainThreadHangMonitor.shared.start()
        URLCache.shared = URLCache(memoryCapacity: 50 * 1024 * 1024, diskCapacity: 200 * 1024 * 1024)
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
        let reminder = FestivalReminderService(appGroupID: appGroupID)
        _reminderService = StateObject(wrappedValue: reminder)
        _festivalFavorites = StateObject(wrappedValue: FestivalFavoritesStore(
            appGroupID: appGroupID,
            onSave: { saved in Task { await reminder.schedule(for: saved) } },
            onRemove: { reminder.cancel(id: $0) }
        ))
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
                .environmentObject(reminderService)
                .environmentObject(festivalFavorites)
                .environmentObject(eventFavorites)
                .onOpenURL { url in
                    DeepLinkRouter.shared.handle(url)
                }
        }
        .backgroundTask(.appRefresh(DiscoveryNotificationService.refreshTaskID)) {
            await discoveryService.runDiscovery()
            // 위젯 timeline은 30분마다 깨어나지만 캐시 파일만 다시 읽는다. 앱을 오래 열지 않아도
            // 위젯이 오래된 축제를 붙들고 있지 않도록 이 백그라운드 회차에서 캐시를 갱신한다.
            await festivalSync.syncNow(coordinate: nil)
            await discoveryService.scheduleNextRefresh()
        }
    }
}
