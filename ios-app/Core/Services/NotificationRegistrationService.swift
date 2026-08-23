import Combine
import Foundation
import UIKit
import UserNotifications

/// 기기의 APNs 토큰과 알림 설정을 서버에 등록한다.
///
/// 다가오는 행사(D-30/D-7/D-1) 알림은 Worker cron이 D1을 조회해 APNs로 직접 보낸다.
/// 서버가 "누구에게 무엇을 보낼지" 판단하려면 기기 토큰·알림 on/off·관심 지역·카테고리를
/// 알아야 하므로, 설정이 바뀔 때마다 여기서 통째로 올린다. (로컬 저장은 그대로 유지된다.)
@MainActor
final class NotificationRegistrationService: ObservableObject {
    /// AppDelegate가 APNs 토큰을 받으면 이 알림을 쏜다. 서비스는 그걸 듣고 재등록한다.
    static let tokenDidChange = Notification.Name("apnsDeviceTokenDidChange")

    private static let tokenKey = "apnsDeviceToken"

    /// APNs 콜백은 메인 스레드지만 이 두 함수는 UserDefaults만 건드리므로 격리에서 뺀다.
    nonisolated static func storeToken(_ token: String, appGroupID: String) {
        UserDefaults(suiteName: appGroupID)?.set(token, forKey: tokenKey)
        NotificationCenter.default.post(name: tokenDidChange, object: nil)
    }

    nonisolated static func token(appGroupID: String) -> String? {
        UserDefaults(suiteName: appGroupID)?.string(forKey: tokenKey)
    }

    private let apiClient: APIClientProtocol
    private let appGroupID: String
    /// 같은 내용을 반복해서 올리지 않기 위한 마지막 전송 본문.
    private var lastSent: NotificationDeviceRegistration?
    private var cancellables: Set<AnyCancellable> = []

    init(apiClient: APIClientProtocol, appGroupID: String) {
        self.apiClient = apiClient
        self.appGroupID = appGroupID
        NotificationCenter.default.publisher(for: Self.tokenDidChange)
            .sink { [weak self] _ in
                Task { await self?.sync() }
            }
            .store(in: &cancellables)
    }

    /// APNs 등록 요청. 권한이 아직 결정되지 않았거나 거부된 상태면 토큰이 나오지 않으므로 건너뛴다.
    func registerForRemoteNotificationsIfAuthorized() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        default:
            break
        }
    }

    /// 현재 설정을 서버에 올린다. 내용이 직전 전송과 같으면 아무것도 하지 않는다.
    func sync(prefs: NotificationPreferences? = nil) async {
        let prefs = prefs ?? NotificationPreferencesStore.load(appGroupID: appGroupID)
        let payload = NotificationDeviceRegistration(
            deviceId: AnonymousDeviceStore.deviceID(),
            apnsToken: Self.token(appGroupID: appGroupID),
            apnsEnvironment: Self.apnsEnvironment,
            festival: .init(
                enabled: prefs.festival.discoveryEnabled,
                regions: prefs.festival.regions,
                categories: prefs.festival.categories.map(\.rawValue).sorted()
            ),
            localEvent: .init(
                enabled: prefs.localEvent.discoveryEnabled,
                regions: prefs.localEvent.regions,
                categories: prefs.localEvent.categories.map(\.rawValue).sorted()
            ),
            quietHours: .init(
                enabled: prefs.quietHoursEnabled,
                startHour: prefs.quietStartHour,
                endHour: prefs.quietEndHour
            )
        )
        guard payload != lastSent else { return }
        do {
            try await apiClient.registerNotificationDevice(payload)
            lastSent = payload
        } catch {
            // 다음 설정 변경이나 앱 재시작에서 다시 시도된다.
            AppLogger.networking.error("notification register failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Debug 빌드는 sandbox APNs, Release(TestFlight·App Store)는 production으로 붙는다.
    private static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
