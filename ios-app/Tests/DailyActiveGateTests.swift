import XCTest
@testable import ParkingLotNavigator

final class DailyActiveGateTests: XCTestCase {
    func testRecordsAtMostOncePerSeoulCalendarDay() throws {
        let suite = "DailyActiveGateTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let gate = DailyActiveGate(defaults: defaults)

        XCTAssertTrue(gate.shouldRecord(now: try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-15T14:59:59Z"))))
        XCTAssertFalse(gate.shouldRecord(now: try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-15T14:59:59Z"))))
        XCTAssertTrue(gate.shouldRecord(now: try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-15T15:00:00Z"))))
    }
}
