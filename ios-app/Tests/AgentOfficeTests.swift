import XCTest
@testable import ParkingLotNavigator

final class AgentOfficeTests: XCTestCase {
    func testCalendarScreenIsPreservedButOfficeOccupiesItsFormerTabPosition() {
        XCTAssertEqual(AppTab.visibleTabs, [.map, .discover, .favorites, .office, .settings])
        XCTAssertFalse(AppTab.visibleTabs.contains(.calendar))
    }

    @MainActor
    func testOfficeRepresentsCurrentSnapshotMerchantAndQueueSystems() async {
        let viewModel = AgentOfficeViewModel(apiClient: MockAPIClient())

        await viewModel.refresh()

        XCTAssertEqual(viewModel.agents.count, 10)
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "atlas" })?.role, "스냅샷·CDN")
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "harbor" })?.role, "사장님 이벤트·Slack")
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "relay" })?.role, "Cron·Queue")
        XCTAssertTrue(viewModel.agents.filter(\.usesGeneratedPortrait).map(\.id).contains("atlas"))
    }
}
