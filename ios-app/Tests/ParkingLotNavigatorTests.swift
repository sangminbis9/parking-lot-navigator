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

    func testFestivalDateRangeUpcomingWithinDays() {
        XCTAssertEqual(FestivalDateRange.ongoingOnly.upcomingWithinDays, 365)
        XCTAssertEqual(FestivalDateRange.oneMonth.upcomingWithinDays, 30)
        XCTAssertEqual(FestivalDateRange.twoMonths.upcomingWithinDays, 60)
        XCTAssertEqual(FestivalDateRange.threeMonths.upcomingWithinDays, 90)
        XCTAssertEqual(FestivalDateRange.sixMonths.upcomingWithinDays, 180)
        XCTAssertEqual(FestivalDateRange.oneYear.upcomingWithinDays, 365)
        XCTAssertEqual(FestivalDateRange.custom.upcomingWithinDays, 365)
    }

    func testFestivalFilterMatchesOngoingOnly() {
        let filter = FestivalFilter(
            regions: [], radiusKm: nil, primaryCategories: [],
            dateRange: .ongoingOnly, customFromDate: nil, customToDate: nil
        )
        let ongoing = Festival.mock(status: .ongoing)
        let upcoming = Festival.mock(status: .upcoming)
        XCTAssertTrue(filter.matches(ongoing))
        XCTAssertFalse(filter.matches(upcoming))
    }

    func testFestivalFilterMatchesCustomDateRange() {
        let filter = FestivalFilter(
            regions: [], radiusKm: nil, primaryCategories: [],
            dateRange: .custom, customFromDate: "2026-07-10", customToDate: "2026-07-20"
        )
        // 겹치는 축제: 7/5~7/12
        let overlaps = Festival.mock(status: .upcoming, startDate: "2026-07-05", endDate: "2026-07-12")
        // 범위 밖: 7/21~7/25
        let after = Festival.mock(status: .upcoming, startDate: "2026-07-21", endDate: "2026-07-25")
        // 범위 밖: 7/1~7/9
        let before = Festival.mock(status: .upcoming, startDate: "2026-07-01", endDate: "2026-07-09")
        XCTAssertTrue(filter.matches(overlaps))
        XCTAssertFalse(filter.matches(after))
        XCTAssertFalse(filter.matches(before))
    }

    func testPerformanceItemFestivalId() {
        let festival = Festival.mock(status: .ongoing)
        let item = PerformanceItem.festival(festival)
        XCTAssertEqual(item.id, "perf-festival-\(festival.id)")
    }

    func testPerformanceItemEventId() {
        let event = FreeEvent.mockPerformance()
        let item = PerformanceItem.event(event)
        XCTAssertEqual(item.id, "perf-event-\(event.id)")
    }

    func testPerformanceItemFestivalDates() {
        let festival = Festival.mock(status: .upcoming, startDate: "2026-07-01", endDate: "2026-07-31")
        let item = PerformanceItem.festival(festival)
        XCTAssertEqual(item.startDate, "2026-07-01")
        XCTAssertEqual(item.endDate, "2026-07-31")
    }

    func testPerformanceItemEventDates() {
        let event = FreeEvent.mockPerformance(startDate: "2026-08-01", endDate: "2026-08-03")
        let item = PerformanceItem.event(event)
        XCTAssertEqual(item.startDate, "2026-08-01")
        XCTAssertEqual(item.endDate, "2026-08-03")
    }

}

private extension Festival {
    static func mock(
        status: DiscoverStatus,
        startDate: String = "2026-06-01",
        endDate: String = "2026-06-30"
    ) -> Festival {
        Festival(
            id: UUID().uuidString,
            title: "테스트 축제",
            subtitle: nil,
            description: nil,
            startDate: startDate,
            endDate: endDate,
            status: status,
            venueName: nil,
            address: "서울",
            lat: 37.5,
            lng: 126.9,
            distanceMeters: 100,
            source: "mock",
            sourceUrl: nil,
            imageUrl: nil,
            imageUrls: [],
            tags: [],
            primaryCategory: nil,
            categoryTags: nil
        )
    }
}

private extension FreeEvent {
    static func mockPerformance(
        startDate: String = "2026-07-01",
        endDate: String = "2026-07-02"
    ) -> FreeEvent {
        FreeEvent(
            id: UUID().uuidString,
            title: "테스트 공연",
            eventType: "performance",
            category: nil,
            sourceId: nil,
            startDate: startDate,
            endDate: endDate,
            status: .approved,
            storeName: "공연장",
            venueName: "공연장",
            address: "서울",
            lat: 37.5,
            lng: 126.9,
            distanceMeters: 100,
            source: "kopis",
            sourceUrl: nil,
            imageUrl: nil,
            benefit: nil,
            shortDescription: nil,
            region: nil,
            updatedAt: nil,
            confidenceScore: nil,
            needsReview: nil,
            isSponsored: false,
            sponsorTier: nil,
            paidUntil: nil,
            priorityScore: 0
        )
    }
}
