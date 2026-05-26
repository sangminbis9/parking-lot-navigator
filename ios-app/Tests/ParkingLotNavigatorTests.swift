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

    func testFestivalTagsUsePrimaryCategoryAndRegion() {
        let tags = DiscoverTagBuilder.festivalTags(
            primaryCategory: .lightNight,
            categoryTags: ["야경"],
            address: "서울특별시 중구 세종대로 110",
            startDate: "2026-05-12",
            rawTags: ["festival", "축제"]
        )

        XCTAssertTrue(tags.contains(FestivalPrimaryCategory.lightNight.displayName))
        XCTAssertTrue(tags.contains("야경"))
        XCTAssertTrue(tags.contains("서울"))
        XCTAssertTrue(tags.contains("중구"))
        XCTAssertTrue(tags.contains("5월"))
        XCTAssertTrue(tags.contains("봄"))
        XCTAssertFalse(tags.contains("축제"))
        XCTAssertFalse(tags.contains("festival"))
    }

    func testEventTagsUsePrimaryCategory() {
        let tags = DiscoverTagBuilder.eventTags(
            primaryCategory: .discount,
            categoryTags: ["할인"],
            eventType: "discount",
            address: "서울특별시 중구 세종대로 110",
            startDate: "2026-04-20"
        )

        XCTAssertTrue(tags.contains(LocalEventPrimaryCategory.discount.displayName))
        XCTAssertTrue(tags.contains("서울"))
        XCTAssertTrue(tags.contains("중구"))
        XCTAssertTrue(tags.contains("4월"))
        XCTAssertTrue(tags.contains("봄"))
    }

}
