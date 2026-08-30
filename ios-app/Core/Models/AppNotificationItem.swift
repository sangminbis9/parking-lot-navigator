import Foundation

/// 알림센터 한 칸. 알림 하나가 아니라 **행사 하나**에 대응한다 —
/// 묶음 알림 하나가 행사 4건을 담고 있으면 카드도 4장이 된다.
///
/// 항목은 알림이 실제로 도착한 순간에만 만든다(예약만 해 둔 알림은 만들지 않는다).
/// 그래서 아직 울리지 않은 예약 알림이 미리 안 읽음으로 보이는 일이 없고,
/// 예약을 취소해도 정리할 항목이 남지 않는다.
struct AppNotificationItem: Codable, Hashable, Identifiable {
    /// `"festival"` | `"local_event"`
    let eventKind: String
    let eventId: String
    /// 이 알림이 가리키는 회차의 시작일(`"yyyy-MM-dd"`). 옛 payload처럼 알 수 없으면 빈 문자열.
    let occurrenceDate: String
    /// 어느 producer가 보냈는지. 카드의 "알림 이유" 문구를 고르는 데만 쓴다.
    var notificationKind: String
    /// 도착 시점 스냅샷. 상세를 다시 받아 오기 전 첫 화면을 그리는 값이다.
    var title: String
    var venueName: String?
    var imageUrl: String?
    /// 같은 회차로 알림이 다시 오면 이 값만 갱신된다.
    var receivedAt: Date
    var isRead: Bool

    /// 같은 행사의 같은 회차는 알림이 몇 번 오든 한 칸이다.
    var id: String { Self.identifier(eventKind: eventKind, eventId: eventId, occurrenceDate: occurrenceDate) }

    static func identifier(eventKind: String, eventId: String, occurrenceDate: String) -> String {
        "\(eventKind)|\(eventId)|\(occurrenceDate)"
    }

    var isFestival: Bool { eventKind != AppNotificationKind.localEventKind }

    /// 카드에 쓰는 "왜 왔는지" 한 줄.
    var reasonText: String {
        switch notificationKind {
        case AppNotificationKind.upcomingD30: return "30일 후 시작해요"
        case AppNotificationKind.upcomingD7: return "7일 후 시작해요"
        case AppNotificationKind.upcomingD1: return "내일 시작해요"
        case AppNotificationKind.savedReminder: return "저장한 행사가 곧 시작해요"
        case AppNotificationKind.newLocalEvent: return "관심 지역에 새로운 행사가 등록됐어요"
        default: return "다가오는 행사"
        }
    }
}

/// 모든 notification producer(기기 로컬 알림 2종 + 서버 APNs)가 공유하는 payload 키·값.
/// 서버 쪽 짝은 `worker-backend/src/upcomingNotifications.ts`의 `buildNotification`이다.
enum AppNotificationKind {
    // userInfo 키
    static let kindKey = "notificationKind"
    static let eventKindKey = "eventKind"
    static let eventIdKey = "eventId"
    static let occurrenceDateKey = "occurrenceDate"
    static let eventTitleKey = "eventTitle"
    /// 묶음 알림이 싣는 `"<kind>:<id>"` 목록. 구분자는 쉼표(id에는 쉼표가 없다).
    static let eventIdsKey = "eventIds"
    /// `eventIds`와 같은 순서의 제목 목록. 제목에는 쉼표가 들어갈 수 있어 줄바꿈으로 가른다.
    static let eventTitlesKey = "eventTitles"
    /// `eventIds`와 같은 순서의 시작일 목록("yyyy-MM-dd"). 항목마다 시작일이 다른 묶음만 싣는다.
    static let eventDatesKey = "eventDates"

    // notificationKind 값
    static let upcomingD30 = "upcoming_d30"
    static let upcomingD7 = "upcoming_d7"
    static let upcomingD1 = "upcoming_d1"
    static let savedReminder = "saved_reminder"
    static let newLocalEvent = "new_local_event"

    // eventKind 값
    static let festivalKind = "festival"
    static let localEventKind = "local_event"
}

/// 알림 payload를 알림센터 항목으로 옮긴다. 새 계약과 옛 payload를 모두 읽는다.
enum AppNotificationPayload {

    static func items(from userInfo: [AnyHashable: Any], receivedAt: Date = Date()) -> [AppNotificationItem] {
        let kind = userInfo[AppNotificationKind.kindKey] as? String ?? ""
        let occurrence = userInfo[AppNotificationKind.occurrenceDateKey] as? String
            ?? userInfo["eventDate"] as? String
            ?? ""

        // 1) 묶음 알림 — 담긴 행사마다 카드를 한 장씩 만든다.
        if let joined = userInfo[AppNotificationKind.eventIdsKey] as? String, !joined.isEmpty {
            let titles = (userInfo[AppNotificationKind.eventTitlesKey] as? String)?
                .components(separatedBy: "\n") ?? []
            // 서버 묶음은 담긴 행사가 모두 같은 날 시작하지만, 기기에서 만드는 묶음은 그렇지 않다.
            // 항목별 시작일이 실려 있으면 그것을 쓰고, 없으면 묶음 전체의 기준일을 쓴다.
            let dates = (userInfo[AppNotificationKind.eventDatesKey] as? String)?
                .components(separatedBy: ",") ?? []
            return joined.components(separatedBy: ",").enumerated().compactMap { index, token in
                let parts = token.components(separatedBy: ":")
                guard parts.count >= 2 else { return nil }
                let eventKind = parts[0]
                let eventId = parts.dropFirst().joined(separator: ":")
                guard !eventId.isEmpty else { return nil }
                return AppNotificationItem(
                    eventKind: eventKind,
                    eventId: eventId,
                    occurrenceDate: index < dates.count ? dates[index] : occurrence,
                    notificationKind: kind,
                    title: index < titles.count ? titles[index] : "",
                    venueName: nil,
                    imageUrl: nil,
                    receivedAt: receivedAt,
                    isRead: false
                )
            }
        }

        // 2) 행사 JSON을 통째로 싣는 기기 로컬 알림. id만 있는 payload보다 먼저 본다 —
        //    제목·장소·사진 스냅샷을 그대로 얻어 첫 화면을 더 정확히 그릴 수 있다.
        if let festival = decode(Festival.self, from: userInfo["festivalJSON"]) {
            return [AppNotificationItem(
                eventKind: AppNotificationKind.festivalKind,
                eventId: festival.id,
                occurrenceDate: occurrence.isEmpty ? festival.startDate : occurrence,
                notificationKind: kind.isEmpty ? AppNotificationKind.savedReminder : kind,
                title: festival.title,
                venueName: festival.venueName,
                imageUrl: festival.primaryImageUrl,
                receivedAt: receivedAt,
                isRead: false
            )]
        }
        if let event = decode(FreeEvent.self, from: userInfo["eventJSON"]) {
            return [AppNotificationItem(
                eventKind: AppNotificationKind.localEventKind,
                eventId: event.id,
                occurrenceDate: occurrence.isEmpty ? event.startDate : occurrence,
                notificationKind: kind.isEmpty ? AppNotificationKind.newLocalEvent : kind,
                title: event.title,
                venueName: event.venueName ?? event.storeName,
                imageUrl: event.primaryImageUrl,
                receivedAt: receivedAt,
                isRead: false
            )]
        }

        // 3) 행사 하나를 가리키는 알림(서버 푸시).
        if let eventKind = userInfo[AppNotificationKind.eventKindKey] as? String,
           eventKind != "digest",
           let eventId = userInfo[AppNotificationKind.eventIdKey] as? String, !eventId.isEmpty {
            return [AppNotificationItem(
                eventKind: eventKind,
                eventId: eventId,
                occurrenceDate: occurrence,
                notificationKind: kind,
                title: userInfo[AppNotificationKind.eventTitleKey] as? String ?? "",
                venueName: nil,
                imageUrl: nil,
                receivedAt: receivedAt,
                isRead: false
            )]
        }

        // 4) 옛 묶음 알림처럼 가리킬 행사를 알 수 없는 payload. 보관함에는 남기지 않는다.
        return []
    }

    private static func decode<T: Decodable>(_ type: T.Type, from raw: Any?) -> T? {
        guard let jsonString = raw as? String,
              let data = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
