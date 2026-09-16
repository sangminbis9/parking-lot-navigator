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
        XCTAssertEqual(viewModel.agents.filter(\.usesGeneratedPortrait).count, 10)
        XCTAssertEqual(
            Dictionary(uniqueKeysWithValues: viewModel.agents.map { ($0.id, $0.name) }),
            [
                "orion": "총괄이", "festa": "축제맨", "scout": "행사맨",
                "vera": "검증이", "pixel": "사진이", "sentinel": "주차맨",
                "echo": "게시알", "atlas": "스냅이", "harbor": "가게알",
                "relay": "전달이"
            ]
        )
    }
}
