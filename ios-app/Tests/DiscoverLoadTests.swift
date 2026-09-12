import XCTest
@testable import ParkingLotNavigator

/// `축제 / 이벤트` 탭 진입 시 간헐적으로 뜨던 "데이터를 불러오지 못했습니다" 회귀를 막는다.
/// 예전에는 세 호출 중 하나만 실패해도 탭 전체가 오류 화면이 됐다.
final class DiscoverLoadTests: XCTestCase {
    private let partialNotice = "일부 정보를 불러오지 못했습니다"
    private let staleNotice = "최신 정보를 불러오지 못했습니다"

    // MARK: - 부분 성공

    func testBothLoadedShowsNoNotice() {
        let outcome = DiscoverLoad.outcome(festivalsLoaded: true, eventsLoaded: true, hasExistingItems: false)
        XCTAssertEqual(outcome, .loaded(partialNotice: nil))
    }

    func testFestivalsOnlyFailureKeepsEvents() {
        let outcome = DiscoverLoad.outcome(festivalsLoaded: false, eventsLoaded: true, hasExistingItems: false)
        XCTAssertEqual(outcome, .loaded(partialNotice: partialNotice))
    }

    func testLocalEventsOnlyFailureKeepsFestivals() {
        let outcome = DiscoverLoad.outcome(festivalsLoaded: true, eventsLoaded: false, hasExistingItems: false)
        XCTAssertEqual(outcome, .loaded(partialNotice: partialNotice))
    }

    func testAllFailedWithoutItemsShowsFullError() {
        let outcome = DiscoverLoad.outcome(festivalsLoaded: false, eventsLoaded: false, hasExistingItems: false)
        XCTAssertEqual(outcome, .failed)
    }

    /// 뒤에서 갱신하다 둘 다 실패한 경우. 이미 보고 있던 목록을 오류 화면으로 덮지 않는다.
    func testAllFailedWithItemsKeepsListAndShowsNotice() {
        let outcome = DiscoverLoad.outcome(festivalsLoaded: false, eventsLoaded: false, hasExistingItems: true)
        XCTAssertEqual(outcome, .failedWithExistingItems(notice: staleNotice))
    }

    // MARK: - 공연 병합

    /// 공연만 실패한 경우. 축제·이벤트 결과는 그대로고 안내도 띄우지 않는다.
    func testPerformanceFailureDoesNotAffectOutcome() {
        let outcome = DiscoverLoad.outcome(festivalsLoaded: true, eventsLoaded: true, hasExistingItems: false)
        XCTAssertEqual(outcome, .loaded(partialNotice: nil))
        XCTAssertNil(DiscoverLoad.merging([], performanceEvents: []))
    }

    func testMergingAppendsOnlyNewPerformanceEvents() throws {
        let existing = [try makeEvent(id: "a"), try makeEvent(id: "b")]
        let performances = [try makeEvent(id: "b"), try makeEvent(id: "c")]
        let merged = try XCTUnwrap(DiscoverLoad.merging(existing, performanceEvents: performances))
        XCTAssertEqual(merged.map(\.id), ["a", "b", "c"])
    }

    func testMergingReturnsNilWhenNothingNew() throws {
        let existing = [try makeEvent(id: "a")]
        XCTAssertNil(DiscoverLoad.merging(existing, performanceEvents: [try makeEvent(id: "a")]))
    }

    // MARK: - 중복 로드 방지 (빠른 탭 전환)

    /// .onAppear와 탭 전환이 잇달아 부를 때. 두 번째 호출은 진행 중인 조회를 취소하지 않는다.
    func testSecondStartIsSkippedWhileLoadInFlight() {
        XCTAssertTrue(DiscoverLoad.shouldStart(force: false, hasItems: false, isStale: true, isInFlight: false))
        XCTAssertFalse(DiscoverLoad.shouldStart(force: false, hasItems: false, isStale: true, isInFlight: true))
    }

    /// 강제 재시도는 진행 중인 조회가 있어도 통과한다.
    func testForcedRetryStartsEvenWhileLoadInFlight() {
        XCTAssertTrue(DiscoverLoad.shouldStart(force: true, hasItems: true, isStale: false, isInFlight: true))
    }

    /// 10분 stale refresh 유지 확인. 목록이 있고 신선하면 탭을 오가도 다시 부르지 않는다.
    func testFreshListIsNotReloadedOnTabSwitch() {
        XCTAssertFalse(DiscoverLoad.shouldStart(force: false, hasItems: true, isStale: false, isInFlight: false))
        XCTAssertTrue(DiscoverLoad.shouldStart(force: false, hasItems: true, isStale: true, isInFlight: false))
    }

    // MARK: - Helper

    private func makeEvent(id: String) throws -> FreeEvent {
        let json = """
        {"id":"\(id)","title":"행사 \(id)","eventType":"local_event","startDate":"2026-09-12",
         "address":"서울시 중구","lat":37.56,"lng":126.97,"distanceMeters":0,"source":"test"}
        """
        return try JSONDecoder().decode(FreeEvent.self, from: Data(json.utf8))
    }
}
