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

    static let allRadiusOptions: [Int] = [10, 20, 50]

    static let `default` = NotificationPreferences(
        festival: .default,
        localEvent: .default,
        quietHoursEnabled: true,
        quietStartHour: 22,
        quietEndHour: 8
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
        case festival, localEvent, quietHoursEnabled, quietStartHour, quietEndHour
    }

    init(
        festival: FestivalNotificationPrefs,
        localEvent: LocalEventNotificationPrefs,
        quietHoursEnabled: Bool,
        quietStartHour: Int,
        quietEndHour: Int
    ) {
        self.festival = festival
        self.localEvent = localEvent
        self.quietHoursEnabled = quietHoursEnabled
        self.quietStartHour = quietStartHour
        self.quietEndHour = quietEndHour
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = NotificationPreferences.default
        festival = try c.decodeIfPresent(FestivalNotificationPrefs.self, forKey: .festival) ?? d.festival
        localEvent = try c.decodeIfPresent(LocalEventNotificationPrefs.self, forKey: .localEvent) ?? d.localEvent
        quietHoursEnabled = try c.decodeIfPresent(Bool.self, forKey: .quietHoursEnabled) ?? d.quietHoursEnabled
        quietStartHour = try c.decodeIfPresent(Int.self, forKey: .quietStartHour) ?? d.quietStartHour
        quietEndHour = try c.decodeIfPresent(Int.self, forKey: .quietEndHour) ?? d.quietEndHour
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

    /// 시도(광역) 및 하위 도시/구 중심 좌표. 지역 선택 시 백그라운드 발견 조회의 중심점으로 사용한다.
    /// 중복 이름(남구·동구·서구·북구·중구·강서구·고성군 등)은 광역 키로만 커버한다.
    static let regionCentroids: [String: (lat: Double, lng: Double)] = [
        // 17 광역시도
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
        "제주": (33.4890, 126.4983),
        // 서울 구 (고유명)
        "강남구": (37.5172, 127.0473), "강동구": (37.5301, 127.1238),
        "관악구": (37.4784, 126.9516), "광진구": (37.5385, 127.0823),
        "노원구": (37.6542, 127.0568), "마포구": (37.5638, 126.9084),
        "서초구": (37.4837, 127.0324), "성동구": (37.5633, 127.0371),
        "성북구": (37.5894, 127.0167), "송파구": (37.5145, 127.1059),
        "영등포구": (37.5264, 126.8963), "용산구": (37.5324, 126.9905),
        "은평구": (37.6176, 126.9227), "종로구": (37.5735, 126.9790),
        // 부산 구/군 (고유명)
        "금정구": (35.2431, 129.0940), "기장군": (35.2441, 129.2227),
        "동래구": (35.1988, 129.0854), "사하구": (35.1041, 128.9743),
        "수영구": (35.1456, 129.1132), "연제구": (35.1731, 129.0813),
        "영도구": (35.0912, 129.0681), "해운대구": (35.1628, 129.1639),
        // 대구 구/군 (고유명)
        "달서구": (35.8294, 128.5321), "달성군": (35.7748, 128.4313), "수성구": (35.8582, 128.6308),
        // 인천 구/군 (고유명)
        "강화군": (37.7474, 126.4876), "계양구": (37.5375, 126.7383),
        "남동구": (37.4469, 126.7310), "미추홀구": (37.4638, 126.6504),
        "부평구": (37.5077, 126.7223), "연수구": (37.4106, 126.6780), "옹진군": (37.4461, 126.3669),
        // 광주·대전·울산 고유명
        "광산구": (35.1396, 126.7935),
        "대덕구": (36.3464, 127.4149), "유성구": (36.3624, 127.3563),
        "울주군": (35.5227, 129.2448),
        // 경기
        "가평군": (37.8314, 127.5100), "고양시": (37.6584, 126.8320),
        "과천시": (37.4292, 126.9878), "광명시": (37.4784, 126.8643),
        "광주시": (37.4296, 127.2553), "구리시": (37.5943, 127.1296),
        "군포시": (37.3614, 126.9352), "김포시": (37.6152, 126.7154),
        "남양주시": (37.6360, 127.2165), "동두천시": (37.9036, 127.0606),
        "부천시": (37.5035, 126.7660), "성남시": (37.4196, 127.1267),
        "수원시": (37.2636, 127.0286), "시흥시": (37.3800, 126.8032),
        "안산시": (37.3219, 126.8309), "안성시": (37.0079, 127.2797),
        "안양시": (37.3942, 126.9568), "양주시": (37.7853, 127.0457),
        "양평군": (37.4916, 127.4877), "여주시": (37.2980, 127.6375),
        "연천군": (38.0962, 127.0750), "오산시": (37.1498, 127.0775),
        "용인시": (37.2411, 127.1776), "의왕시": (37.3447, 126.9684),
        "의정부시": (37.7381, 127.0338), "이천시": (37.2720, 127.4352),
        "파주시": (37.7599, 126.7800), "평택시": (36.9922, 127.1129),
        "포천시": (37.8949, 127.2002), "하남시": (37.5392, 127.2147), "화성시": (37.1995, 126.8313),
        // 강원 (고성군 제외 — 경남과 중복)
        "강릉시": (37.7519, 128.8761), "동해시": (37.5244, 129.1143),
        "삼척시": (37.4499, 129.1650), "속초시": (38.2070, 128.5918),
        "양구군": (38.1098, 127.9895), "양양군": (38.0754, 128.6189),
        "영월군": (37.1837, 128.4613), "원주시": (37.3422, 127.9202),
        "인제군": (38.0694, 128.1701), "정선군": (37.3804, 128.6601),
        "철원군": (38.1469, 127.3134), "춘천시": (37.8813, 127.7299),
        "태백시": (37.1635, 128.9858), "평창군": (37.3724, 128.3905),
        "홍천군": (37.6969, 127.8876), "화천군": (38.1062, 127.7084), "횡성군": (37.4916, 127.9846),
        // 충북
        "괴산군": (36.8149, 127.7862), "단양군": (36.9848, 128.3658),
        "보은군": (36.4896, 127.7283), "영동군": (36.1748, 127.7757),
        "옥천군": (36.3063, 127.5713), "음성군": (36.9404, 127.6901),
        "제천시": (37.1323, 128.1904), "증평군": (36.7851, 127.5832),
        "진천군": (36.8556, 127.4330), "청주시": (36.6424, 127.4890), "충주시": (36.9910, 127.9259),
        // 충남
        "계룡시": (36.2741, 127.2496), "공주시": (36.4465, 127.1191),
        "금산군": (36.1085, 127.4879), "논산시": (36.1875, 127.0990),
        "당진시": (36.8895, 126.6457), "보령시": (36.3334, 126.6127),
        "부여군": (36.2752, 126.9098), "서산시": (36.7849, 126.4503),
        "서천군": (36.0785, 126.6912), "아산시": (36.7898, 127.0042),
        "예산군": (36.6801, 126.8444), "천안시": (36.8151, 127.1139),
        "청양군": (36.4593, 126.8024), "태안군": (36.7456, 126.2978), "홍성군": (36.6014, 126.6601),
        // 전북
        "고창군": (35.4347, 126.7022), "군산시": (35.9677, 126.7370),
        "김제시": (35.8035, 126.8808), "남원시": (35.4163, 127.3898),
        "무주군": (35.9070, 127.6607), "부안군": (35.7318, 126.7332),
        "순창군": (35.3747, 127.1377), "완주군": (35.9047, 127.1622),
        "익산시": (35.9483, 126.9575), "임실군": (35.6177, 127.2891),
        "장수군": (35.6476, 127.5215), "전주시": (35.8242, 127.1479),
        "정읍시": (35.5700, 126.8584), "진안군": (35.7917, 127.4245),
        // 전남
        "강진군": (34.6415, 126.7671), "고흥군": (34.6116, 127.2781),
        "곡성군": (35.2816, 127.2917), "광양시": (34.9406, 127.6956),
        "구례군": (35.2025, 127.4628), "나주시": (35.0160, 126.7101),
        "담양군": (35.3213, 126.9884), "목포시": (34.8118, 126.3922),
        "무안군": (34.9903, 126.4812), "보성군": (34.7713, 127.0800),
        "순천시": (34.9506, 127.4872), "신안군": (34.8300, 126.1000),
        "여수시": (34.7604, 127.6622), "영광군": (35.2779, 126.5122),
        "영암군": (34.8003, 126.6967), "완도군": (34.3139, 126.7551),
        "장성군": (35.3024, 126.7846), "장흥군": (34.6822, 126.9079),
        "진도군": (34.4867, 126.2634), "함평군": (35.0659, 126.5161),
        "해남군": (34.5740, 126.5998), "화순군": (35.0641, 126.9863),
        // 경북
        "경산시": (35.8253, 128.7413), "경주시": (35.8562, 129.2249),
        "고령군": (35.7267, 128.2636), "구미시": (36.1196, 128.3443),
        "군위군": (36.2413, 128.5726), "김천시": (36.1397, 128.1133),
        "문경시": (36.5861, 128.1877), "봉화군": (36.8928, 128.7322),
        "상주시": (36.4107, 128.1592), "성주군": (35.9196, 128.2826),
        "안동시": (36.5684, 128.7294), "영덕군": (36.4151, 129.3660),
        "영양군": (36.6664, 129.1123), "영주시": (36.8057, 128.6240),
        "영천시": (35.9736, 128.9381), "예천군": (36.6576, 128.4526),
        "울릉군": (37.4845, 130.9057), "울진군": (36.9930, 129.4005),
        "의성군": (36.3526, 128.6972), "청도군": (35.6474, 128.7338),
        "청송군": (36.4358, 129.0566), "칠곡군": (35.9947, 128.4016), "포항시": (36.0190, 129.3435),
        // 경남 (고성군 제외 — 강원과 중복)
        "거제시": (34.8801, 128.6217), "거창군": (35.6868, 127.9099),
        "김해시": (35.2285, 128.8893), "남해군": (34.8370, 127.8921),
        "밀양시": (35.5036, 128.7460), "사천시": (35.0036, 128.0638),
        "산청군": (35.4149, 127.8733), "양산시": (35.3350, 129.0372),
        "의령군": (35.3220, 128.2641), "진주시": (35.1800, 128.1076),
        "창녕군": (35.5464, 128.4916), "창원시": (35.2278, 128.6817),
        "통영시": (34.8544, 128.4335), "하동군": (35.0671, 127.7512),
        "함안군": (35.2724, 128.4066), "함양군": (35.5200, 127.7252), "합천군": (35.5664, 128.1661),
        // 제주
        "서귀포시": (33.2541, 126.5600), "제주시": (33.5000, 126.5310)
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
