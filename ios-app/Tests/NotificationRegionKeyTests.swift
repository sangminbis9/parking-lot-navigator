import XCTest
@testable import ParkingLotNavigator

/// 관심 지역 키(광역시도 + 시/군/구) 매칭·마이그레이션 검증.
/// 서버 `worker-backend/src/regionMatch.ts`와 같은 규칙이므로 두 쪽 테스트가 짝을 이룬다.
final class NotificationRegionKeyTests: XCTestCase {

    // MARK: - 전국 전체

    func testEmptyRegionsMatchesEverywhere() {
        XCTAssertTrue(NotificationRegionKey.matches(address: "제주특별자치도 서귀포시 중문동", regions: []))
        XCTAssertTrue(NotificationRegionKey.matches(address: "부산광역시 해운대구", regions: []))
        XCTAssertTrue(NotificationRegionKey.matches(address: "", regions: []))
    }

    // MARK: - 중복 이름 구분

    func testSameDistrictNameInDifferentProvincesDoesNotMatch() {
        let seoulJunggu = [NotificationRegionKey.make(province: "서울", district: "중구")]
        XCTAssertTrue(NotificationRegionKey.matches(address: "서울특별시 중구 세종대로 110", regions: seoulJunggu))
        XCTAssertFalse(NotificationRegionKey.matches(address: "부산광역시 중구 중앙대로 120", regions: seoulJunggu))
    }

    func testGoseongGunIsDistinguishedByProvince() {
        let gangwonGoseong = [NotificationRegionKey.make(province: "강원", district: "고성군")]
        XCTAssertTrue(NotificationRegionKey.matches(address: "강원특별자치도 고성군 간성읍", regions: gangwonGoseong))
        XCTAssertFalse(NotificationRegionKey.matches(address: "경상남도 고성군 고성읍", regions: gangwonGoseong))
    }

    func testProvinceOnlyKeyMatchesEveryDistrict() {
        XCTAssertTrue(NotificationRegionKey.matches(address: "부산광역시 중구 중앙대로 120", regions: ["부산"]))
        XCTAssertTrue(NotificationRegionKey.matches(address: "부산광역시 해운대구 우동", regions: ["부산"]))
        XCTAssertFalse(NotificationRegionKey.matches(address: "서울특별시 중구 세종대로 110", regions: ["부산"]))
    }

    func testProvinceAliasesAreParsed() {
        XCTAssertEqual(NotificationRegionKey.parse(address: "충청남도 천안시 서북구").province, "충남")
        XCTAssertEqual(NotificationRegionKey.parse(address: "경기도 수원시 팔달구").district, "수원시")
        XCTAssertNil(NotificationRegionKey.parse(address: "알 수 없는 주소").province)
    }

    func testUnknownProvinceNeverMatchesSelectedRegions() {
        XCTAssertFalse(NotificationRegionKey.matches(address: "주소 없음", regions: ["서울"]))
    }

    // MARK: - 키 조립/표시

    func testMakeAndSplitRoundTrip() {
        let key = NotificationRegionKey.make(province: "강원", district: "고성군")
        XCTAssertEqual(key, "강원|고성군")
        let parts = NotificationRegionKey.split(key)
        XCTAssertEqual(parts.province, "강원")
        XCTAssertEqual(parts.district, "고성군")
        XCTAssertNil(NotificationRegionKey.split("강원").district)
    }

    func testDisplayNameKeepsReadableForm() {
        XCTAssertEqual(NotificationRegionKey.displayName("서울|중구"), "서울 중구")
        XCTAssertEqual(NotificationRegionKey.displayName("강원|고성군"), "강원 고성")
        XCTAssertEqual(NotificationRegionKey.displayName("제주"), "제주")
    }

    // MARK: - 기존 저장값 마이그레이션

    func testMigrateQualifiesUniqueDistrictNames() {
        XCTAssertEqual(NotificationRegionKey.migrate(legacy: ["해운대구"]), ["부산|해운대구"])
        XCTAssertEqual(NotificationRegionKey.migrate(legacy: ["수원시"]), ["경기|수원시"])
    }

    func testMigrateKeepsProvincesAndQualifiedKeys() {
        XCTAssertEqual(NotificationRegionKey.migrate(legacy: ["서울", "부산|중구"]), ["서울", "부산|중구"])
    }

    func testMigrateDropsAmbiguousBareDistrictNames() {
        // "중구"·"고성군"은 어느 광역시도를 고른 것인지 알 수 없다. 임의로 정하면
        // 사용자가 고르지 않은 지역의 알림이 가므로 버린다.
        XCTAssertEqual(NotificationRegionKey.migrate(legacy: ["중구", "고성군"]), [])
        XCTAssertEqual(NotificationRegionKey.migrate(legacy: ["서울", "중구"]), ["서울"])
    }

    func testMigrateDeduplicates() {
        XCTAssertEqual(NotificationRegionKey.migrate(legacy: ["해운대구", "부산|해운대구"]), ["부산|해운대구"])
    }

    // MARK: - 조회 중심 좌표

    func testCentroidFallsBackToProvinceForDuplicateDistrictNames() {
        // "중구"는 좌표표에 없다(중복 이름). 광역시도 좌표로 떨어져야 한다.
        let seoulJunggu = NotificationRegionKey.centroid(for: "서울|중구")
        let seoul = NotificationRegionKey.centroid(for: "서울")
        XCTAssertNotNil(seoulJunggu)
        XCTAssertEqual(seoulJunggu?.lat, seoul?.lat)
        XCTAssertEqual(seoulJunggu?.lng, seoul?.lng)
    }
}
