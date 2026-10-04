import SwiftUI
import UserNotifications
import KakaoMapsSDK
import KakaoSDKCommon

@main
struct ParkingLotNavigatorApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var destinationStore = DestinationStore()
    @StateObject private var themeStore = FestivalThemeStore()
    @StateObject private var festivalSync: FestivalSyncService
    @StateObject private var notificationPrefs: NotificationPreferencesModel
    @StateObject private var discoveryService: DiscoveryNotificationService
    @StateObject private var reminderService: FestivalReminderService
    @StateObject private var notificationRegistration: NotificationRegistrationService
    @StateObject private var festivalFavorites: FestivalFavoritesStore
    @StateObject private var eventFavorites: LocalEventFavoritesStore
    /// 첫 실행 위치 권한 팝업용. 팝업이 떠 있는 동안 manager가 살아 있어야 해서 앱 수명으로 잡아 둔다.
    @StateObject private var launchLocation = CurrentLocationProvider()
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
        _notificationRegistration = StateObject(wrappedValue: NotificationRegistrationService(
            apiClient: client,
            appGroupID: appGroupID
        ))
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
                .environmentObject(notificationRegistration)
                .task {
                    AnalyticsService.shared.trackDailyActive()
                    // UI 테스트가 딥링크 경로를 그대로 태우는 통로. 푸시 전달 자체는 흉내내지 않는다.
                    let args = ProcessInfo.processInfo.arguments
                    if let index = args.firstIndex(of: "-uiTestingDeepLink"),
                       index + 1 < args.count,
                       let url = URL(string: args[index + 1]) {
                        DeepLinkRouter.shared.handle(url)
                    }
                    // 첫 실행이면 알림 → 위치 순으로 시스템 권한 팝업을 띄운다. 이미 답한 권한은 다시 묻지 않는다.
                    // 알림 요청은 사용자가 답할 때까지 기다리므로 두 팝업이 겹치지 않는다.
                    // UI 테스트는 시스템 팝업을 다룰 수 없어 건너뛴다.
                    if !args.contains("-uiTesting") {
                        let center = UNUserNotificationCenter.current()
                        if await center.notificationSettings().authorizationStatus == .notDetermined {
                            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
                        }
                        launchLocation.request()
                    }
                    // 서버가 D-30/D-7/D-1 발송 대상을 고르므로, 실행할 때마다 토큰과 설정을 맞춰 둔다.
                    await notificationRegistration.registerForRemoteNotificationsIfAuthorized()
                    await notificationRegistration.sync()
                }
                .onOpenURL { url in
                    DeepLinkRouter.shared.handle(url)
                }
                .onChange(of: scenePhase) { phase in
                    // 모아 둔 집계는 앱이 물러날 때 한 번만 보낸다. 시작이나 탭 이동은 건드리지 않는다.
                    if phase != .active { AnalyticsService.shared.flush() }
                }
        }
        .backgroundTask(.appRefresh(DiscoveryNotificationService.refreshTaskID)) {
            // 위젯 timeline은 30분마다 깨어나지만 캐시 파일만 다시 읽는다. 앱을 오래 열지 않아도
            // 위젯이 오래된 축제를 붙들고 있지 않도록 이 백그라운드 회차에서 캐시를 갱신한다.
            await festivalSync.syncNow(coordinate: nil)
            await discoveryService.runDiscovery()
            await discoveryService.scheduleNextRefresh()
        }
    }
}
