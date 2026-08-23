import UIKit
import UserNotifications

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
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

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        // 서버 푸시는 전체 JSON 대신 (종류, id)만 싣는다. 상세는 앱이 API로 다시 받아 온다 —
        // APNs payload 4KB 한도에 축제 JSON 전체가 들어가지 않고, 담기더라도 발송 시점의
        // 낡은 사본이 열리기 때문이다.
        if let kind = userInfo["eventKind"] as? String, let id = userInfo["eventId"] as? String {
            DispatchQueue.main.async {
                switch kind {
                case "local_event": DeepLinkRouter.shared.pendingLocalEventId = id
                case "festival": DeepLinkRouter.shared.pendingFestivalId = id
                default: break   // digest 알림은 앱만 연다.
                }
            }
            completionHandler()
            return
        }
        // 기기에서 만든 로컬 알림은 예전처럼 JSON을 통째로 싣는다.
        if let jsonString = userInfo["festivalJSON"] as? String,
           let data = jsonString.data(using: .utf8),
           let festival = try? JSONDecoder().decode(Festival.self, from: data) {
            DispatchQueue.main.async {
                DeepLinkRouter.shared.pendingFestival = festival
            }
        } else if let jsonString = userInfo["eventJSON"] as? String,
                  let data = jsonString.data(using: .utf8),
                  let event = try? JSONDecoder().decode(FreeEvent.self, from: data) {
            DispatchQueue.main.async {
                DeepLinkRouter.shared.pendingEvent = event
            }
        }
        completionHandler()
    }
}
