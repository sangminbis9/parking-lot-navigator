import XCTest

/// 핵심 사용자 여정만 검증한다. 화면 개수를 따라가는 테스트는 두지 않는다.
///
/// 앱에 심어 둔 테스트 이음새는 세 가지뿐이다.
/// - `-uiTesting`: 익명 집계 전송을 끈다.
/// - `-uiTestingDenyLocation`: 위치 권한 요청 자체를 건너뛴다(시스템 팝업을 다룰 수 없어서다).
/// - `-uiTestingDeepLink <url>`: 딥링크 URL을 라우터에 그대로 넣는다.
/// 그 외 화면 데이터는 실제 서버 응답을 그대로 쓴다. 목 응답을 주입하지 않는다.
final class CoreJourneyUITests: XCTestCase {

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    private func launch(_ extraArguments: [String] = [], environment: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"] + extraArguments
        app.launchEnvironment = environment
        app.launch()
        return app
    }

    /// 식별자는 붙은 뷰 종류가 SwiftUI 버전에 따라 달라진다. 종류를 가리지 않고 찾는다.
    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    // MARK: - 1. 위치 권한 없이도 손으로 탐색할 수 있어야 한다

    func testBrowsingWorksWithoutLocationPermission() {
        let app = launch(["-uiTestingDenyLocation"])

        let mapTab = element("tab-map", in: app)
        XCTAssertTrue(mapTab.waitForExistence(timeout: 20), "위치 권한이 없어도 지도 탭은 떠 있어야 한다")

        let discoverTab = element("tab-discover", in: app)
        XCTAssertTrue(discoverTab.waitForExistence(timeout: 10))
        discoverTab.tap()

        // 목록·빈 상태·오류 중 무엇이 오든 화면 자체는 살아 있어야 한다.
        let discoverScreen = app.staticTexts["축제 / 이벤트"]
        XCTAssertTrue(discoverScreen.waitForExistence(timeout: 20), "이벤트 탭이 열리지 않았다")
    }

    // MARK: - 2. 위치 권한을 허용한 흐름

    /// 시스템 권한 팝업은 앱 프로세스 밖이라 인터럽션 모니터로만 다룰 수 있다.
    /// 팝업이 뜨지 않는 실행(이미 결정된 시뮬레이터)에서도 통과해야 하므로,
    /// 권한 허용 그 자체가 아니라 "허용 흐름에서도 지도 탭이 정상 동작한다"를 검증한다.
    func testMapTabStaysUsableWhenLocationPromptIsAllowed() {
        addUIInterruptionMonitor(withDescription: "위치 권한") { alert in
            for label in ["앱을 사용하는 동안 허용", "허용", "Allow While Using App", "Allow"] {
                let button = alert.buttons[label]
                if button.exists {
                    button.tap()
                    return true
                }
            }
            return false
        }

        let app = launch()
        let mapTab = element("tab-map", in: app)
        XCTAssertTrue(mapTab.waitForExistence(timeout: 20))
        app.tap() // 인터럽션 모니터를 깨운다.

        XCTAssertTrue(mapTab.isHittable, "권한 팝업 처리 후에도 지도 탭이 조작 가능해야 한다")
    }

    // MARK: - 3. 행사 선택 → 상세 → 즐겨찾기

    /// 목록 데이터는 서버에서 온다. 목 응답을 넣지 않기로 했으므로, 목록이 비어 있는
    /// 환경(오프라인 CI 등)에서는 실패가 아니라 skip으로 남긴다.
    func testEventDetailAndFavoriteToggle() throws {
        let app = launch(["-uiTestingDenyLocation"])

        let discoverTab = element("tab-discover", in: app)
        XCTAssertTrue(discoverTab.waitForExistence(timeout: 20))
        discoverTab.tap()

        let row = element("discover-row", in: app)
        guard row.waitForExistence(timeout: 30) else {
            throw XCTSkip("행사 목록이 비어 있어 상세 진입을 검증할 수 없다")
        }
        row.tap()

        let favorite = element("event-favorite-button", in: app)
        XCTAssertTrue(favorite.waitForExistence(timeout: 20), "행사 상세에 즐겨찾기 버튼이 없다")

        let wasSaved = favorite.label == "관심 축제 해제"
        favorite.tap()

        let expectedLabel = wasSaved ? "관심 축제로 저장" : "관심 축제 해제"
        let toggled = NSPredicate(format: "label == %@", expectedLabel)
        expectation(for: toggled, evaluatedWith: favorite)
        waitForExpectations(timeout: 10)
    }

    // MARK: - 4. 네트워크 오류 → 오류 UI → 재시도

    func testNetworkFailureShowsRetryableError() {
        // 닿을 수 없는 주소로 바꿔 실패 경로를 만든다. 앱 코드에는 분기를 넣지 않는다.
        let app = launch(
            ["-uiTestingDenyLocation"],
            environment: ["UITEST_API_BASE_URL": "https://127.0.0.1:9"]
        )

        let discoverTab = element("tab-discover", in: app)
        XCTAssertTrue(discoverTab.waitForExistence(timeout: 20))
        discoverTab.tap()

        let message = element("failure-message", in: app)
        XCTAssertTrue(message.waitForExistence(timeout: 40), "네트워크 실패인데 오류 문구가 없다")

        let retry = element("failure-retry", in: app)
        XCTAssertTrue(retry.waitForExistence(timeout: 10), "재시도 버튼이 없다")
        retry.tap()

        // 다시 눌러도 같은 실패로 돌아와야 한다. 버튼이 화면을 망가뜨리면 안 된다.
        XCTAssertTrue(message.waitForExistence(timeout: 40))
    }

    // MARK: - 5. 딥링크 진입

    /// 푸시 전달 자체는 XCUITest가 흉내낼 수 없다. 푸시가 앱에 넘기는 것과 같은 URL을
    /// 라우터에 태워, 딥링크가 해당 화면으로 보내는지만 확인한다.
    func testDeepLinkOpensCalendar() {
        let app = launch(["-uiTestingDenyLocation", "-uiTestingDeepLink", "parkingnavigator://calendar"])

        // 캘린더 화면에만 있는 컨트롤이다.
        let nextMonth = app.buttons["다음 달"]
        XCTAssertTrue(nextMonth.waitForExistence(timeout: 25), "딥링크가 캘린더 탭을 열지 않았다")
    }
}
