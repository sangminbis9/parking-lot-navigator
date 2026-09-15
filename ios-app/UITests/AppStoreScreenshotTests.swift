import XCTest

/// App Store 제출용 스크린샷을 시뮬레이터에서 캡처한다.
///
/// 로컬 Mac이 없으므로 `.github/workflows/ios-screenshots.yml`이 macOS 러너에서 이 테스트만
/// 지목해 돌리고, 첨부된 PNG를 아티팩트로 뽑아낸다. 일반 CI 테스트와 함께 돌지 않는다.
///
/// 검증 테스트가 아니라 캡처 도구다. 화면 하나가 비어 있어도 나머지 캡처를 계속하고,
/// 실패로 처리하지 않는다 — 한 장이 비었다고 나머지 네 장을 잃는 쪽이 손해다.
/// 대신 무엇을 못 찍었는지는 로그에 남긴다.
final class AppStoreScreenshotTests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// 서버 응답을 그대로 쓰기 때문에 목록이 그려질 시간을 넉넉히 준다.
    private func capture(_ name: String, settle: TimeInterval = 2.0) {
        // 레이아웃이 자리를 잡고 이미지가 도착할 여유를 준다.
        // 지도 타일과 캘린더 어젠다는 네트워크를 더 타므로 호출부가 여유를 늘려 준다.
        Thread.sleep(forTimeInterval: settle)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// 탭으로 이동한다. 탭이 없으면 false를 돌려 호출부가 그 화면을 건너뛰게 한다.
    @discardableResult
    private func openTab(_ identifier: String) -> Bool {
        let tab = element(identifier)
        guard tab.waitForExistence(timeout: 30) else {
            XCTContext.runActivity(named: "탭 없음: \(identifier)") { _ in }
            return false
        }
        tab.tap()
        return true
    }

    func testCaptureAppStoreScreenshots() {
        app = XCUIApplication()
        app.launch()

        // 1. 지도 — 첫 화면이다. 탭 바는 즉시 뜨지만 지도 타일은 그 뒤에 도착한다.
        // 1회차(2026-09-11)에서 핀은 그려졌는데 타일만 빈 화면이었다.
        if element("tab-map").waitForExistence(timeout: 40) {
            capture("01-map", settle: 15.0)
        }

        // 2. 행사 목록
        if openTab("tab-discover") {
            _ = element("discover-row").waitForExistence(timeout: 40)
            capture("02-discover")

            // 3. 행사 상세 — 목록이 비면 건너뛴다.
            let row = element("discover-row")
            if row.exists {
                row.tap()
                _ = element("event-favorite-button").waitForExistence(timeout: 30)
                capture("03-detail")

                // 상세 아래쪽(요금·프로그램)도 한 장 남긴다.
                app.swipeUp()
                capture("04-detail-scrolled")

                // 목록으로 돌아간다. 네비게이션 바 뒤로가기 버튼 이름은 화면마다 다르므로
                // 첫 번째 버튼을 쓰지 않고 스와이프로 되돌린다.
                app.swipeRight()
            } else {
                XCTContext.runActivity(named: "행사 목록이 비어 상세를 못 찍었다") { _ in }
            }
        }

        // 5. 에이전트 사무실
        if openTab("tab-office") {
            capture("05-agent-office", settle: 12.0)
        }

        // 6. 즐겨찾기 — 새 시뮬레이터라 비어 있을 수 있다. 쓸지는 사람이 고른다.
        if openTab("tab-favorites") {
            capture("06-favorites")
        }

        // 7. 설정 — 사장님 이벤트 등록 카드가 여기 있다(앱 안의 유일한 진입점).
        // 카드가 접히는 위치는 기기 높이에 따라 달라지므로 위와 아래를 각각 한 장씩 남긴다.
        if openTab("tab-settings") {
            capture("07-settings")
            app.swipeUp()
            capture("08-settings-scrolled")
        }
    }
}
