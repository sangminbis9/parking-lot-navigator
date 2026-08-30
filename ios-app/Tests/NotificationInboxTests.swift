import XCTest
@testable import ParkingLotNavigator

/// 알림 payload 계약(`AppNotificationPayload`)과 알림센터 저장소(`NotificationInboxStore`) 검증.
/// producer는 셋(저장한 축제 리마인더 · 새 로컬 이벤트 알림 · 서버 APNs)이고 payload 모양은
/// 옛 것까지 다섯 가지라, 어느 하나가 카드를 만들지 못하면 그 알림은 목적지를 잃는다.
final class AppNotificationPayloadTests: XCTestCase {

    private let receivedAt = Date(timeIntervalSince1970: 1_756_000_000)

    // MARK: - 기기 로컬 알림

    func testSavedFestivalReminderCarriesDestination() {
        let items = AppNotificationPayload.items(from: [
            AppNotificationKind.kindKey: AppNotificationKind.savedReminder,
            AppNotificationKind.eventKindKey: AppNotificationKind.festivalKind,
            AppNotificationKind.eventIdKey: "fest-1",
            AppNotificationKind.occurrenceDateKey: "2026-09-10",
            AppNotificationKind.eventTitleKey: "\u{BD80}\u{C0B0}\u{BD88}\u{AF43}\u{CD95}\u{C81C}"
        ], receivedAt: receivedAt)

        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].eventKind, "festival")
        XCTAssertEqual(items[0].eventId, "fest-1")
        XCTAssertEqual(items[0].occurrenceDate, "2026-09-10")
        XCTAssertEqual(items[0].id, "festival|fest-1|2026-09-10")
        XCTAssertFalse(items[0].isRead)
    }

    func testLocalEventDigestBecomesOneItemPerEvent() {
        let items = AppNotificationPayload.items(from: [
            AppNotificationKind.kindKey: AppNotificationKind.newLocalEvent,
            AppNotificationKind.eventIdsKey: "local_event:a,local_event:b,local_event:c",
            AppNotificationKind.eventTitlesKey: "A\nB\nC",
            AppNotificationKind.eventDatesKey: "2026-09-01,2026-09-02,2026-09-03"
        ], receivedAt: receivedAt)

        XCTAssertEqual(items.map(\.eventId), ["a", "b", "c"])
        XCTAssertEqual(items.map(\.occurrenceDate), ["2026-09-01", "2026-09-02", "2026-09-03"])
        XCTAssertEqual(items.map(\.title), ["A", "B", "C"])
        XCTAssertTrue(items.allSatisfy { $0.eventKind == AppNotificationKind.localEventKind })
    }

    func testDigestWithoutPerItemDatesFallsBackToSharedDate() {
        let items = AppNotificationPayload.items(from: [
            AppNotificationKind.kindKey: AppNotificationKind.upcomingD7,
            AppNotificationKind.occurrenceDateKey: "2026-09-07",
            AppNotificationKind.eventIdsKey: "festival:x,local_event:y",
            AppNotificationKind.eventTitlesKey: "X\nY"
        ], receivedAt: receivedAt)

        XCTAssertEqual(items.map(\.occurrenceDate), ["2026-09-07", "2026-09-07"])
        XCTAssertEqual(items.map(\.eventKind), ["festival", "local_event"])
    }

    // MARK: - 서버 APNs

    func testServerSingleEventPush() {
        let items = AppNotificationPayload.items(from: [
            "eventKind": "local_event",
            "eventId": "le-9",
            "notificationType": "D1",
            "notificationKind": AppNotificationKind.upcomingD1,
            "occurrenceDate": "2026-09-05",
            "eventTitle": "\u{ADF8}\u{B79C}\u{B4DC}\u{C624}\u{D508}"
        ], receivedAt: receivedAt)

        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].id, "local_event|le-9|2026-09-05")
        XCTAssertEqual(items[0].reasonText, "\u{B0B4}\u{C77C} \u{C2DC}\u{C791}\u{D574}\u{C694}")
    }

    // MARK: - 옛 payload

    func testLegacyEventJSONStillResolves() {
        let json = """
        {"id":"le-legacy","title":"\u{ACE0}\u{AE30}\u{C9D1} 1+1","eventType":"discount","startDate":"2026-09-04",\
        "storeName":"\u{C815}\u{C721}\u{C810}","venueName":"\u{C815}\u{C721}\u{C810}","address":"\u{C11C}\u{C6B8}\u{C2DC} \u{C911}\u{AD6C}",\
        "lat":37.5,"lng":127.0,"distanceMeters":100,"source":"naver_blog","imageUrl":"https://example.com/a.jpg"}
        """
        let items = AppNotificationPayload.items(from: ["eventJSON": json], receivedAt: receivedAt)

        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].eventId, "le-legacy")
        XCTAssertEqual(items[0].occurrenceDate, "2026-09-04")
        XCTAssertEqual(items[0].notificationKind, AppNotificationKind.newLocalEvent)
        XCTAssertEqual(items[0].imageUrl, "https://example.com/a.jpg")
    }

    func testLegacyDigestWithoutEventListProducesNoItem() {
        // 옛 서버 묶음 푸시. 가리킬 행사를 알 수 없어 보관함에는 남기지 않고
        // 예전처럼 캘린더로만 보낸다.
        let items = AppNotificationPayload.items(from: [
            "eventKind": "digest",
            "notificationType": "D7",
            "eventDate": "2026-09-07"
        ], receivedAt: receivedAt)
        XCTAssertTrue(items.isEmpty)
    }

    func testUnknownPayloadIsIgnored() {
        XCTAssertTrue(AppNotificationPayload.items(from: [:], receivedAt: receivedAt).isEmpty)
        XCTAssertTrue(AppNotificationPayload.items(from: ["foo": "bar"], receivedAt: receivedAt).isEmpty)
        XCTAssertTrue(AppNotificationPayload.items(
            from: [AppNotificationKind.eventIdsKey: "festival:"], receivedAt: receivedAt).isEmpty)
    }
}

final class NotificationInboxStoreTests: XCTestCase {

    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "notificationInboxTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        super.tearDown()
    }

    private func item(
        id: String,
        date: String = "2026-09-10",
        kind: String = AppNotificationKind.festivalKind,
        title: String = "A",
        receivedAt: Date = Date(timeIntervalSince1970: 1_756_000_000)
    ) -> AppNotificationItem {
        AppNotificationItem(
            eventKind: kind, eventId: id, occurrenceDate: date,
            notificationKind: AppNotificationKind.upcomingD7, title: title,
            venueName: nil, imageUrl: nil, receivedAt: receivedAt, isRead: false)
    }

    func testSameOccurrenceIsOneCard() {
        let store = NotificationInboxStore(defaults: defaults)
        store.ingest([item(id: "f1")])
        store.markRead(id: "festival|f1|2026-09-10")
        store.ingest([item(id: "f1", title: "A \u{C0C8} \u{C81C}\u{BAA9}")])

        XCTAssertEqual(store.items.count, 1)
        XCTAssertEqual(store.items[0].title, "A \u{C0C8} \u{C81C}\u{BAA9}")
        // 같은 회차가 다시 오면 다시 안 읽음으로 돌아온다.
        XCTAssertEqual(store.unreadCount, 1)
    }

    func testDifferentOccurrenceStaysSeparate() {
        let store = NotificationInboxStore(defaults: defaults)
        store.ingest([item(id: "f1", date: "2026-09-10"), item(id: "f1", date: "2026-10-01")])
        XCTAssertEqual(store.items.count, 2)
    }

    func testMarkReadAndMarkAllRead() {
        let store = NotificationInboxStore(defaults: defaults)
        store.ingest([item(id: "f1"), item(id: "f2"), item(id: "f3")])
        XCTAssertEqual(store.unreadCount, 3)

        store.markRead(id: "festival|f2|2026-09-10")
        XCTAssertEqual(store.unreadCount, 2)

        store.markAllRead()
        XCTAssertEqual(store.unreadCount, 0)
    }

    func testStateSurvivesRelaunch() {
        let store = NotificationInboxStore(defaults: defaults)
        store.ingest([item(id: "f1"), item(id: "f2")])
        store.markRead(id: "festival|f1|2026-09-10")

        let relaunched = NotificationInboxStore(defaults: defaults)
        XCTAssertEqual(relaunched.items.count, 2)
        XCTAssertEqual(relaunched.unreadCount, 1)
    }

    func testOldOccurrencesArePrunedAndCountIsCapped() {
        let store = NotificationInboxStore(defaults: defaults)
        store.ingest([item(id: "old", date: "2020-01-01"), item(id: "fresh", date: "2999-01-01")])
        XCTAssertEqual(store.items.map(\.eventId), ["fresh"])

        let many = (0..<260).map {
            item(id: "e\($0)", date: "2999-01-01",
                 receivedAt: Date(timeIntervalSince1970: 1_756_000_000 + Double($0)))
        }
        store.ingest(many)
        XCTAssertEqual(store.items.count, 200)
        // 오래된 쪽부터 잘린다.
        XCTAssertTrue(store.items.contains { $0.eventId == "e259" })
        XCTAssertFalse(store.items.contains { $0.eventId == "e0" })
    }

    func testRemoveDropsCard() {
        let store = NotificationInboxStore(defaults: defaults)
        store.ingest([item(id: "f1")])
        store.remove(id: "festival|f1|2026-09-10")
        XCTAssertTrue(store.items.isEmpty)
    }
}
