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

    func testFestivalTagsPreferUsefulContext() {
        let tags = DiscoverTagBuilder.festivalTags(
            title: "서울 빛 축제",
            subtitle: "야간 산책형 라이트 행사",
            venueName: "서울광장",
            address: "서울특별시 중구 세종대로 110",
            startDate: "2026-05-12",
            source: "서울 열린데이터광장",
            rawTags: ["festival", "축제"]
        )

        XCTAssertTrue(tags.contains("빛"))
        XCTAssertTrue(tags.contains("서울"))
        XCTAssertTrue(tags.contains("중구"))
        XCTAssertTrue(tags.contains("5월"))
        XCTAssertTrue(tags.contains("봄"))
        XCTAssertTrue(tags.contains("야간"))
        XCTAssertTrue(tags.contains("서울시"))
        XCTAssertFalse(tags.contains("축제"))
        XCTAssertFalse(tags.contains("festival"))
    }

    func testEventTagsTranslateEnglishCategory() {
        let tags = DiscoverTagBuilder.eventTags(
            title: "시민 전시",
            eventType: "exhibition",
            description: "무료 공공 전시",
            venueName: "시민청",
            address: "서울특별시 중구 세종대로 110",
            startDate: "2026-04-20",
            source: "culture portal"
        )

        XCTAssertTrue(tags.contains("전시"))
        XCTAssertTrue(tags.contains("서울"))
        XCTAssertTrue(tags.contains("중구"))
        XCTAssertTrue(tags.contains("4월"))
        XCTAssertTrue(tags.contains("봄"))
        XCTAssertTrue(tags.contains("문화포털"))
        XCTAssertFalse(tags.contains("exhibition"))
    }

}
