import CoreLocation
import XCTest
@testable import ParkingLotNavigator

@MainActor
final class MapDiscoveryLoadingTests: XCTestCase {
    private let a = MapViewport(center: CLLocationCoordinate2D(latitude: 37.4, longitude: 126.6), zoomLevel: 13, radiusMeters: 20000)
    private let b = MapViewport(center: CLLocationCoordinate2D(latitude: 35.2, longitude: 129.1), zoomLevel: 13, radiusMeters: 20000)

    private func model(_ client: ControlledDiscoveryClient) -> MapHomeViewModel {
        let model = MapHomeViewModel(apiClient: client)
        model.showsLocalEventLayer = false
        model.showsPerformanceLayer = false
        return model
    }

    func testOlderInitialLocationResponseCannotOverwriteNewViewport() async throws {
        let client = ControlledDiscoveryClient()
        let model = model(client)
        let startedA = expectation(description: "A requested")
        let startedB = expectation(description: "B requested")
        client.onRequest = { lat, _ in (lat == self.a.center.latitude ? startedA : startedB).fulfill() }
        let first = Task { await model.loadDiscoverLayers(viewport: a) }
        await fulfillment(of: [startedA], timeout: 2)
        let second = Task { await model.loadDiscoverLayers(viewport: b, showsSpinner: false) }
        await fulfillment(of: [startedB], timeout: 2)
        XCTAssertTrue(model.isFetchingDiscover, "지도 이동의 조용한 조회도 로딩 배지에 알려야 한다")
        XCTAssertFalse(model.isLoadingDiscover)
        let items = try await MockAPIClient().nearbyFestivals(lat: b.center.latitude, lng: b.center.longitude, radiusMeters: 20000, upcomingWithinDays: 365)
        client.finish(b.center.latitude, .success(items))
        let secondLoaded = await second.value
        XCTAssertTrue(secondLoaded)
        let expected = model.festivals
        XCTAssertFalse(expected.isEmpty)
        client.finish(a.center.latitude, .success([]))
        let firstLoaded = await first.value
        XCTAssertFalse(firstLoaded)
        XCTAssertEqual(model.festivals, expected)
        XCTAssertEqual(model.completedDiscoverViewport, b)
        XCTAssertFalse(model.isLoadingDiscover)
        XCTAssertFalse(model.isFetchingDiscover)
    }

    func testCancelledLoadDoesNotCommitOrLeaveSpinnerRunning() async {
        let client = ControlledDiscoveryClient()
        let model = model(client)
        let started = expectation(description: "requested")
        client.onRequest = { _, _ in started.fulfill() }
        let task = Task { await model.loadDiscoverLayers(viewport: a) }
        await fulfillment(of: [started], timeout: 2)
        task.cancel()
        client.finish(a.center.latitude, .success([]))
        let loaded = await task.value
        XCTAssertFalse(loaded)
        XCTAssertFalse(model.isLoadingDiscover)
        XCTAssertFalse(model.isFetchingDiscover)
    }

    func testFailureIsNotReportedAsLoadedAndQueryCoversVisibleMargin() async {
        let client = ControlledDiscoveryClient()
        let model = model(client)
        let started = expectation(description: "requested")
        client.onRequest = { _, radius in
            XCTAssertGreaterThanOrEqual(radius, 32000)
            started.fulfill()
        }
        let task = Task { await model.loadDiscoverLayers(viewport: a, showsError: true) }
        await fulfillment(of: [started], timeout: 2)
        client.finish(a.center.latitude, .failure(URLError(.timedOut)))
        let loaded = await task.value
        XCTAssertFalse(loaded)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertFalse(model.isFetchingDiscover)
        XCTAssertNil(model.completedDiscoverViewport)
        XCTAssertFalse(model.isLoadingDiscover)
    }
}

@MainActor
private final class ControlledDiscoveryClient: APIClientProtocol {
    var onRequest: ((Double, Int) -> Void)?
    private var pending: [Double: CheckedContinuation<[Festival], Error>] = [:]
    func finish(_ lat: Double, _ result: Result<[Festival], Error>) {
        pending.removeValue(forKey: lat)?.resume(with: result)
    }
    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int, pastWithinDays: Int) async throws -> [Festival] {
        try await withCheckedThrowingContinuation { continuation in
            pending[lat] = continuation
            onRequest?(lat, radiusMeters)
        }
    }
    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent] { [] }
    func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent]) { ([], []) }
    func searchDestination(query: String) async throws -> [Destination] { [] }
    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] { [] }
    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] { [] }
    func providerHealth() async throws -> [ProviderHealth] { [] }
    func discoveryProviderHealth() async throws -> [ProviderHealth] { [] }
    func agentActivity(since: String?, limit: Int) async throws -> [AgentActivityEvent] { [] }
    func pipelineStats() async throws -> PipelineStats { throw URLError(.unsupportedURL) }
    func festival(id: String) async throws -> Festival { throw URLError(.unsupportedURL) }
    func localEvent(id: String) async throws -> FreeEvent { throw URLError(.unsupportedURL) }
    func registerNotificationDevice(_ registration: NotificationDeviceRegistration) async throws {}
    func submitEventReport(_ report: EventReportSubmission) async throws {}
}
