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
    func testDiscoverClustersUseRealtimeZoomThreshold() {
        let viewModel = MapHomeViewModel(apiClient: MockAPIClient())

        XCTAssertTrue(viewModel.shouldShowRealtimeClusters(zoomLevel: 13))
        XCTAssertTrue(viewModel.shouldShowDiscoverClusters(zoomLevel: 13))
        XCTAssertFalse(viewModel.shouldShowRealtimeClusters(zoomLevel: 14))
        XCTAssertFalse(viewModel.shouldShowDiscoverClusters(zoomLevel: 14))
    }

    @MainActor
    func testFestivalClustersRefineAtCloserZoom() {
        let viewModel = MapHomeViewModel(apiClient: MockAPIClient())
        viewModel.festivals = [
            makeFestival(id: "festival-1", lat: 37.0000, lng: 127.0000),
            makeFestival(id: "festival-2", lat: 37.1500, lng: 127.0000),
            makeFestival(id: "festival-3", lat: 37.3000, lng: 127.0000)
        ]

        XCTAssertEqual(viewModel.festivalClustersForZoom(zoomLevel: 11).map(\.count).sorted(), [3])
        XCTAssertEqual(viewModel.festivalClustersForZoom(zoomLevel: 12).map(\.count).sorted(), [1, 1, 1])
    }

    @MainActor
    func testEventClustersRefineAtCloserZoom() {
        let viewModel = MapHomeViewModel(apiClient: MockAPIClient())
        viewModel.events = [
            makeEvent(id: "event-1", lat: 37.0000, lng: 127.0000),
            makeEvent(id: "event-2", lat: 37.1500, lng: 127.0000),
            makeEvent(id: "event-3", lat: 37.3000, lng: 127.0000)
        ]

        XCTAssertEqual(viewModel.eventClustersForZoom(zoomLevel: 11).map(\.count).sorted(), [3])
        XCTAssertEqual(viewModel.eventClustersForZoom(zoomLevel: 12).map(\.count).sorted(), [1, 1, 1])
    }

    private func makeFestival(id: String, lat: Double, lng: Double) -> Festival {
        Festival(
            id: id,
            title: id,
            subtitle: nil,
            startDate: "2026-04-22",
            endDate: "2026-04-23",
            status: .ongoing,
            venueName: nil,
            address: "Test address",
            lat: lat,
            lng: lng,
            distanceMeters: 0,
            source: "test",
            sourceUrl: nil,
            imageUrl: nil,
            tags: []
        )
    }

    private func makeEvent(id: String, lat: Double, lng: Double) -> FreeEvent {
        FreeEvent(
            id: id,
            title: id,
            eventType: "test",
            startDate: "2026-04-22",
            endDate: "2026-04-23",
            status: .ongoing,
            isFree: true,
            venueName: nil,
            address: "Test address",
            lat: lat,
            lng: lng,
            distanceMeters: 0,
            source: "test",
            sourceUrl: nil,
            imageUrl: nil,
            shortDescription: nil
        )
    }
}
