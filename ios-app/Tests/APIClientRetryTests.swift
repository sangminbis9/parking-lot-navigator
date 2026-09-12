import XCTest
@testable import ParkingLotNavigator

/// 응답을 마음대로 만들어 주는 스텁. `APIClient(session:)`에 끼워 넣어 재시도 횟수를 센다.
final class StubURLProtocol: URLProtocol {
    /// 호출 순서대로 꺼내 쓴다. 성공이면 (status, body), 실패면 URLError를 던진다.
    static var responses: [() throws -> (Int, Data)] = []
    static var requestCount = 0

    static func reset() {
        responses = []
        requestCount = 0
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let index = min(StubURLProtocol.requestCount, StubURLProtocol.responses.count - 1)
        StubURLProtocol.requestCount += 1
        guard index >= 0 else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (status, body) = try StubURLProtocol.responses[index]()
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class APIClientRetryTests: XCTestCase {
    private var client: APIClient!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        client = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            session: URLSession(configuration: configuration)
        )
    }

    override func tearDown() {
        StubURLProtocol.reset()
        client = nil
        super.tearDown()
    }

    private func ok(_ body: String) -> () throws -> (Int, Data) {
        { (200, Data(body.utf8)) }
    }

    private func status(_ code: Int) -> () throws -> (Int, Data) {
        { (code, Data("{}".utf8)) }
    }

    private func failure(_ code: URLError.Code) -> () throws -> (Int, Data) {
        { throw URLError(code) }
    }

    // MARK: - 재시도

    /// 5xx는 한 번만 다시 시도한다. 두 번 다 실패하면 endpoint 라벨과 상태 코드가 살아서 나온다.
    func testServerErrorRetriesOnceThenThrowsLabeledError() async {
        StubURLProtocol.responses = [status(500), status(500)]
        do {
            _ = try await client.nearbyFestivals(lat: 36.35, lng: 127.8, radiusMeters: 460_000, upcomingWithinDays: 365)
            XCTFail("실패해야 한다")
        } catch let error as APIHTTPError {
            XCTAssertEqual(error.endpoint, .festivals)
            XCTAssertEqual(error.statusCode, 500)
        } catch {
            XCTFail("APIHTTPError여야 한다: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.requestCount, 2)
    }

    func testServerErrorRecoversOnSecondAttempt() async throws {
        StubURLProtocol.responses = [status(503), ok("[]")]
        let festivals = try await client.nearbyFestivals(lat: 36.35, lng: 127.8, radiusMeters: 460_000, upcomingWithinDays: 365)
        XCTAssertTrue(festivals.isEmpty)
        XCTAssertEqual(StubURLProtocol.requestCount, 2)
    }

    func testTimeoutRetriesOnce() async {
        StubURLProtocol.responses = [failure(.timedOut), failure(.timedOut)]
        do {
            _ = try await client.nearbyEvents(lat: 36.35, lng: 127.8, radiusMeters: 460_000)
            XCTFail("실패해야 한다")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .timedOut)
        } catch {
            XCTFail("URLError여야 한다: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.requestCount, 2)
    }

    func testConnectionLostRetriesOnce() async {
        StubURLProtocol.responses = [failure(.networkConnectionLost), ok("[]")]
        let events = try? await client.nearbyEvents(lat: 36.35, lng: 127.8, radiusMeters: 460_000)
        XCTAssertEqual(events?.count, 0)
        XCTAssertEqual(StubURLProtocol.requestCount, 2)
    }

    // MARK: - 재시도하지 않는 실패

    /// 일반 4xx는 다시 해도 같은 답이 온다.
    func testClientErrorDoesNotRetry() async {
        StubURLProtocol.responses = [status(404)]
        do {
            _ = try await client.nearbyEvents(lat: 36.35, lng: 127.8, radiusMeters: 460_000)
            XCTFail("실패해야 한다")
        } catch let error as APIHTTPError {
            XCTAssertEqual(error.endpoint, .localEvents)
            XCTAssertEqual(error.statusCode, 404)
            XCTAssertFalse(error.isRetryable)
        } catch {
            XCTFail("APIHTTPError여야 한다: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.requestCount, 1)
    }

    func testDecodingFailureDoesNotRetry() async {
        StubURLProtocol.responses = [ok("{\"nope\":1}")]
        do {
            _ = try await client.nearbyPerformances(lat: 36.35, lng: 127.8, radiusMeters: 460_000, upcomingWithinDays: 365)
            XCTFail("실패해야 한다")
        } catch {
            XCTAssertTrue(error is DecodingError, "DecodingError여야 한다: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.requestCount, 1)
    }

    /// 429는 잠시 뒤 풀리는 실패라 재시도 대상이다.
    func testRetryableStatusCodes() {
        XCTAssertTrue(APIHTTPError(endpoint: .festivals, statusCode: 429).isRetryable)
        XCTAssertTrue(APIHTTPError(endpoint: .festivals, statusCode: 502).isRetryable)
        XCTAssertFalse(APIHTTPError(endpoint: .festivals, statusCode: 400).isRetryable)
        XCTAssertFalse(APIHTTPError(endpoint: .festivals, statusCode: 403).isRetryable)
    }

    // MARK: - 라벨

    /// Worker `ANALYTICS_EVENTS.api_error` 허용 목록과 철자가 맞아야 집계에 남는다.
    /// 목록에 없는 값은 서버가 조용히 버린다.
    func testAnalyticsLabelsMatchWorkerAllowlist() {
        XCTAssertEqual(APIEndpointLabel.festivals.analyticsLabel, "festival")
        XCTAssertEqual(APIEndpointLabel.localEvents.analyticsLabel, "local_event")
        XCTAssertEqual(APIEndpointLabel.performances.analyticsLabel, "performance")
        XCTAssertEqual(APIEndpointLabel.parking.analyticsLabel, "parking")
        XCTAssertEqual(APIEndpointLabel.other.analyticsLabel, "other")
    }

    /// 로그에 남는 이름에는 좌표도 전체 URL도 들어 있지 않다.
    func testEndpointLabelsAreCoordinateFree() {
        XCTAssertEqual(APIEndpointLabel.festivals.rawValue, "festivals")
        XCTAssertEqual(APIEndpointLabel.localEvents.rawValue, "local-events")
        XCTAssertEqual(APIEndpointLabel.performances.rawValue, "performances")
    }
}
