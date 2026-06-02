import Combine
import Foundation

/// 축제 알림 설정. 발견 알림(관심 카테고리/지역 기반)과 저장한 축제 리마인더 시점을 함께 관리한다.
struct FestivalNotificationPrefs: Codable, Hashable {
    var discoveryEnabled: Bool          // 새 축제 발견 알림 on/off
    var categories: Set<FestivalPrimaryCategory> // 비면 전체
    var radiusKm: Int                   // 지역 미선택 시 현재 위치 기준 반경
    var regions: [String]               // 비면 현재 위치 반경 사용
    var savedReminderEnabled: Bool      // 저장한 축제 리마인더 on/off
    var leadDays: Int                   // 0/1/3/7
    var reminderHour: Int               // 0–23

    static let allLeadDayOptions: [Int] = [0, 1, 3, 7]

    static let `default` = FestivalNotificationPrefs(
        discoveryEnabled: false,
        categories: [],
        radiusKm: 50,
        regions: [],
        savedReminderEnabled: true,
        leadDays: 1,
        reminderHour: 9
    )

    enum CodingKeys: String, CodingKey {
        case discoveryEnabled, categories, radiusKm, regions, savedReminderEnabled, leadDays, reminderHour
    }

    init(
        discoveryEnabled: Bool,
        categories: Set<FestivalPrimaryCategory>,
        radiusKm: Int,
        regions: [String],
        savedReminderEnabled: Bool,
        leadDays: Int,
        reminderHour: Int
    ) {
        self.discoveryEnabled = discoveryEnabled
        self.categories = categories
        self.radiusKm = radiusKm
        self.regions = regions
        self.savedReminderEnabled = savedReminderEnabled
        self.leadDays = leadDays
        self.reminderHour = reminderHour
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = FestivalNotificationPrefs.default
        discoveryEnabled = try c.decodeIfPresent(Bool.self, forKey: .discoveryEnabled) ?? d.discoveryEnabled
        categories = try c.decodeIfPresent(Set<FestivalPrimaryCategory>.self, forKey: .categories) ?? d.categories
        radiusKm = try c.decodeIfPresent(Int.self, forKey: .radiusKm) ?? d.radiusKm
        regions = try c.decodeIfPresent([String].self, forKey: .regions) ?? d.regions
        savedReminderEnabled = try c.decodeIfPresent(Bool.self, forKey: .savedReminderEnabled) ?? d.savedReminderEnabled
        leadDays = try c.decodeIfPresent(Int.self, forKey: .leadDays) ?? d.leadDays
        reminderHour = try c.decodeIfPresent(Int.self, forKey: .reminderHour) ?? d.reminderHour
    }
}

/// 로컬 이벤트 알림 설정. 저장 기능이 없으므로 관심 카테고리/지역 기반 발견 알림만 다룬다.
struct LocalEventNotificationPrefs: Codable, Hashable {
    var discoveryEnabled: Bool
    var categories: Set<LocalEventPrimaryCategory> // 비면 전체
    var radiusKm: Int
    var regions: [String]

    static let `default` = LocalEventNotificationPrefs(
        discoveryEnabled: false,
        categories: [],
        radiusKm: 50,
        regions: []
    )

    enum CodingKeys: String, CodingKey {
        case discoveryEnabled, categories, radiusKm, regions
    }

    init(discoveryEnabled: Bool, categories: Set<LocalEventPrimaryCategory>, radiusKm: Int, regions: [String]) {
        self.discoveryEnabled = discoveryEnabled
        self.categories = categories
        self.radiusKm = radiusKm
        self.regions = regions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = LocalEventNotificationPrefs.default
        discoveryEnabled = try c.decodeIfPresent(Bool.self, forKey: .discoveryEnabled) ?? d.discoveryEnabled
        categories = try c.decodeIfPresent(Set<LocalEventPrimaryCategory>.self, forKey: .categories) ?? d.categories
        radiusKm = try c.decodeIfPresent(Int.self, forKey: .radiusKm) ?? d.radiusKm
        regions = try c.decodeIfPresent([String].self, forKey: .regions) ?? d.regions
    }
}

struct NotificationPreferences: Codable, Hashable {
    var festival: FestivalNotificationPrefs
    var localEvent: LocalEventNotificationPrefs
    var quietHoursEnabled: Bool
    var quietStartHour: Int             // 방해 금지 시작 시각 (0–23)
    var quietEndHour: Int               // 방해 금지 종료 시각 (0–23)
    var maxNotificationsPerDay: Int

    static let allRadiusOptions: [Int] = [10, 20, 50]

    static let `default` = NotificationPreferences(
        festival: .default,
        localEvent: .default,
        quietHoursEnabled: true,
        quietStartHour: 22,
        quietEndHour: 8,
        maxNotificationsPerDay: 5
    )

    /// 발견 알림이 하나라도 켜져 있는지. 백그라운드 예약 필요 여부 판단에 사용.
    var anyDiscoveryEnabled: Bool {
        festival.discoveryEnabled || localEvent.discoveryEnabled
    }

    /// 주어진 시각(hour)이 방해 금지 구간에 드는지. 자정을 가로지르는 구간(예: 22→8)도 처리.
    func isWithinQuietHours(hour: Int) -> Bool {
        guard quietHoursEnabled, quietStartHour != quietEndHour else { return false }
        if quietStartHour < quietEndHour {
            return hour >= quietStartHour && hour < quietEndHour
        }
        return hour >= quietStartHour || hour < quietEndHour
    }

    enum CodingKeys: String, CodingKey {
        case festival, localEvent, quietHoursEnabled, quietStartHour, quietEndHour, maxNotificationsPerDay
    }

    init(
        festival: FestivalNotificationPrefs,
        localEvent: LocalEventNotificationPrefs,
        quietHoursEnabled: Bool,
        quietStartHour: Int,
        quietEndHour: Int,
        maxNotificationsPerDay: Int
    ) {
        self.festival = festival
        self.localEvent = localEvent
        self.quietHoursEnabled = quietHoursEnabled
        self.quietStartHour = quietStartHour
        self.quietEndHour = quietEndHour
        self.maxNotificationsPerDay = maxNotificationsPerDay
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = NotificationPreferences.default
        festival = try c.decodeIfPresent(FestivalNotificationPrefs.self, forKey: .festival) ?? d.festival
        localEvent = try c.decodeIfPresent(LocalEventNotificationPrefs.self, forKey: .localEvent) ?? d.localEvent
        quietHoursEnabled = try c.decodeIfPresent(Bool.self, forKey: .quietHoursEnabled) ?? d.quietHoursEnabled
        quietStartHour = try c.decodeIfPresent(Int.self, forKey: .quietStartHour) ?? d.quietStartHour
        quietEndHour = try c.decodeIfPresent(Int.self, forKey: .quietEndHour) ?? d.quietEndHour
        maxNotificationsPerDay = try c.decodeIfPresent(Int.self, forKey: .maxNotificationsPerDay) ?? d.maxNotificationsPerDay
    }
}

enum NotificationPreferencesStore {
    private static let key = "notificationPreferences"

    static func load(appGroupID: String) -> NotificationPreferences {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = defaults.data(forKey: key),
              let prefs = try? JSONDecoder().decode(NotificationPreferences.self, from: data) else {
            return .default
        }
        return prefs
    }

    static func save(_ prefs: NotificationPreferences, appGroupID: String) {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let data = try? JSONEncoder().encode(prefs) else { return }
        defaults.set(data, forKey: key)
    }

    /// 시도(광역) 중심 좌표. 지역 선택 시 백그라운드 발견 조회의 중심점으로 사용한다.
    /// 키는 `FestivalFilter.koreanRegions`와 일치시킨다.
    static let regionCentroids: [String: (lat: Double, lng: Double)] = [
        "서울": (37.5663, 126.9779),
        "부산": (35.1796, 129.0756),
        "대구": (35.8714, 128.6014),
        "인천": (37.4563, 126.7052),
        "광주": (35.1595, 126.8526),
        "대전": (36.3504, 127.3845),
        "울산": (35.5384, 129.3114),
        "세종": (36.4801, 127.2890),
        "경기": (37.4138, 127.5183),
        "강원": (37.8228, 128.1555),
        "충북": (36.6357, 127.4912),
        "충남": (36.5184, 126.8000),
        "전북": (35.7175, 127.1530),
        "전남": (34.8161, 126.4630),
        "경북": (36.4919, 128.8889),
        "경남": (35.4606, 128.2132),
        "제주": (33.4890, 126.4983)
    ]
}

@MainActor
final class NotificationPreferencesModel: ObservableObject {
    @Published var prefs: NotificationPreferences {
        didSet {
            guard prefs != oldValue else { return }
            NotificationPreferencesStore.save(prefs, appGroupID: appGroupID)
        }
    }

    private let appGroupID: String

    init(appGroupID: String) {
        self.appGroupID = appGroupID
        self.prefs = NotificationPreferencesStore.load(appGroupID: appGroupID)
    }
}
