import XCTest
@testable import ParkingLotNavigator

final class ParkingLotNavigatorTests: XCTestCase {
    func testMockSearchReturnsDestination() async throws {
        let client = MockAPIClient()
        let items = try await client.searchDestination(query: "서울역")
        XCTAssertFalse(items.isEmpty)
    }

    func testMockParkingContainsStaleWarning() async throws {
        let client = MockAPIClient()
        let items = try await client.nearbyParking(lat: 37.5547, lng: 126.9706, radiusMeters: 800)
        XCTAssertTrue(items.contains(where: { $0.stale }))
    }

    func testRecommendationRanksLowStressParkingFirst() async throws {
        let client = MockAPIClient()
        let destinations = try await client.searchDestination(query: "서울역")
        let destination = try XCTUnwrap(destinations.first)
        let items = try await client.nearbyParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
        let recommendations = ParkingRecommendationEngine().recommendations(for: items, destination: destination)

        XCTAssertEqual(recommendations.first?.parkingLot.id, "mock:1")
        XCTAssertGreaterThan(recommendations.first?.score ?? 0, recommendations.last?.score ?? 0)
        XCTAssertFalse(recommendations.first?.reasons.isEmpty ?? true)
    }

    @MainActor
    func testRealtimeClustersUseReleaseZoomThreshold() {
        let viewModel = MapHomeViewModel(apiClient: MockAPIClient())

        XCTAssertTrue(viewModel.shouldShowRealtimeClusters(zoomLevel: 13))
        XCTAssertFalse(viewModel.shouldShowRealtimeClusters(zoomLevel: 14))
    }

    @MainActor
    func testClusterTapZoomsProgressivelyUntilRelease() {
        let viewModel = MapHomeViewModel(apiClient: MockAPIClient())

        XCTAssertEqual(viewModel.nextClusterZoomLevel(after: 11), 12)
        XCTAssertEqual(viewModel.nextClusterZoomLevel(after: 12), 13)
        XCTAssertEqual(viewModel.nextClusterZoomLevel(after: 13), 14)
        XCTAssertEqual(viewModel.nextClusterZoomLevel(after: 14), 15)
        XCTAssertEqual(viewModel.nextClusterZoomLevel(after: 15), 16)
    }
}
