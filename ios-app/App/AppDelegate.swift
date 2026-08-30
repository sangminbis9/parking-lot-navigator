import UIKit
import UserNotifications

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    /// 서버가 보내는 `eventDate`는 KST 기준 "yyyy-MM-dd"다.
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sweepDeliveredNotifications),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        // 이미 권한을 준 사용자는 실행할 때마다 토큰을 다시 받아 서버 등록을 최신으로 유지한다.
        // (권한이 없으면 APNs가 토큰을 주지 않으므로 요청 자체를 건너뛴다.)
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async { application.registerForRemoteNotifications() }
            default:
                break
            }
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationRegistrationService.storeToken(token, appGroupID: AppConfiguration.current.appGroupID)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        AppLogger.networking.error("APNs registration failed: \(String(describing: error), privacy: .public)")
    }

    /// 앱이 떠 있는 동안 도착한 알림도 알림센터에 남긴다.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        Self.ingest(notification)
        completionHandler([.banner, .sound, .badge])
    }

    /// 앱이 꺼져 있는 동안 온 알림은 사용자가 배너를 탭하지 않으면 `didReceive`가 오지 않는다.
    /// 활성화될 때 알림 센터에 남아 있는 것들을 한 번 훑어 보관함을 채운다.
    /// 데이터 원본이 아니라 유입 경로일 뿐이다 — 읽음 상태와 목록은 보관함이 갖는다.
    /// (SwiftUI scene 생명주기에서는 `applicationDidBecomeActive(_:)`가 불리지 않아 알림으로 받는다.)
    @objc private func sweepDeliveredNotifications() {
        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
            let items = notifications.flatMap {
                AppNotificationPayload.items(from: $0.request.content.userInfo, receivedAt: $0.date)
            }
            guard !items.isEmpty else { return }
            DispatchQueue.main.async { NotificationInboxStore.shared.ingest(items) }
        }
    }

    private static func ingest(_ notification: UNNotification) {
        let items = AppNotificationPayload.items(
            from: notification.request.content.userInfo,
            receivedAt: notification.date
        )
        guard !items.isEmpty else { return }
        DispatchQueue.main.async { NotificationInboxStore.shared.ingest(items) }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        // 알림을 탭하면 행사 상세로 바로 가지 않고 앱 안 알림센터를 연다.
        // 묶음 알림 하나에 행사가 여럿 담겨 있어도 사용자가 무엇이 왔는지 전부 볼 수 있어야 한다.
        // (앱 안 이동과 URL 딥링크는 예전 경로 그대로다.)
        let items = AppNotificationPayload.items(
            from: userInfo,
            receivedAt: response.notification.date
        )
        if !items.isEmpty {
            if let kind = userInfo["eventKind"] as? String {
                AnalyticsService.shared.track(.notificationOpen, label: kind)
            }
            DispatchQueue.main.async {
                NotificationInboxStore.shared.ingest(items)
                DeepLinkRouter.shared.pendingNotificationFocusId = items.first?.id
                DeepLinkRouter.shared.pendingNotificationInboxAt = Date()
            }
            completionHandler()
            return
        }
        // 가리킬 행사를 알 수 없는 옛 묶음 알림은 예전처럼 그 날짜의 달력으로 보낸다.
        if userInfo["eventKind"] as? String == "digest" {
            let day = (userInfo["eventDate"] as? String).flatMap(Self.dayFormatter.date(from:))
            DispatchQueue.main.async {
                DeepLinkRouter.shared.pendingCalendarDay = day
                DeepLinkRouter.shared.pendingCalendarAt = Date()
            }
        }
        completionHandler()
    }
}
