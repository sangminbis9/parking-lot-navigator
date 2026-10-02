import XCTest
@testable import ParkingLotNavigator

final class AgentOfficeTests: XCTestCase {
    func testCalendarScreenIsPreservedButOfficeOccupiesItsFormerTabPosition() {
        XCTAssertEqual(AppTab.visibleTabs, [.map, .discover, .favorites, .office, .settings])
        XCTAssertFalse(AppTab.visibleTabs.contains(.calendar))
    }

    @MainActor
    func testOfficeRepresentsCurrentSnapshotMerchantAndQueueSystems() async {
        let viewModel = AgentOfficeViewModel(apiClient: MockAPIClient())

        await viewModel.refresh()

        XCTAssertEqual(viewModel.agents.count, 10)
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "scout" })?.role, "기존 이벤트 보관")
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "atlas" })?.role, "스냅샷·CDN")
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "harbor" })?.role, "사장님 이벤트·Slack")
        XCTAssertEqual(viewModel.agents.first(where: { $0.id == "relay" })?.role, "Cron·Queue")
        XCTAssertEqual(viewModel.agents.filter(\.usesGeneratedPortrait).count, 10)
        XCTAssertEqual(
            Dictionary(uniqueKeysWithValues: viewModel.agents.map { ($0.id, $0.name) }),
            [
                "orion": "총괄이", "festa": "축제맨", "scout": "행사맨",
                "vera": "검증이", "pixel": "사진이", "sentinel": "주차맨",
                "echo": "게시알", "atlas": "스냅이", "harbor": "가게알",
                "relay": "전달이"
            ]
        )
    }

    // MARK: - Activity text / grouping / bubbles

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private func event(
        _ id: String,
        agent: String,
        action: String,
        reason: String? = nil,
        title: String? = nil,
        at date: Date
    ) -> AgentActivityEvent {
        AgentActivityEvent(
            id: id,
            ts: Self.isoFormatter.string(from: date),
            agentId: agent,
            action: action,
            targetKind: nil,
            targetId: nil,
            targetTitle: title,
            verdict: nil,
            reason: reason
        )
    }

    func testParsesWorkerTimestampsWithFractionalSeconds() {
        XCTAssertNotNil(AgentOfficeDates.parse("2026-10-02T12:30:17.477Z"))
        XCTAssertNotNil(AgentOfficeDates.parse("2026-10-02T12:30:17Z"))
    }

    func testHeadErrorsGetDistinctLabelsWithoutRawText() {
        let now = Date()
        let cases: [(String, String, String)] = [
            ("error", "workers_ai_run_failed:4006: you have used up your daily free allocation", "AI 일일 한도 도달 · 내일 재개"),
            ("error", "workers_ai_run_failed:boom SECRET", "AI 호출 실패"),
            ("error", "workers_ai_empty_response", "AI 응답이 비어 있음"),
            ("error", "workers_ai_json_parse_failed:Unexpected token SECRET", "AI 응답 형식 오류"),
            ("apply_error", "head_apply_failed:D1_ERROR SECRET", "검토 결과 반영 실패"),
            ("query_error", "head_review_query_failed", "검토 대상 조회 실패")
        ]
        for (action, reason, expected) in cases {
            let line = AgentActivityText.line(for: event("x", agent: "orion", action: action, reason: reason, at: now))
            XCTAssertEqual(line, expected)
            XCTAssertFalse(line?.contains("SECRET") ?? true)
        }
        let pixelError = AgentActivityText.line(for: event("p", agent: "pixel", action: "image_error", reason: "fetch failed SECRET", at: now))
        XCTAssertEqual(pixelError, "사진 보강 실패")
    }

    func testRepeatedErrorsCollapseIntoOneRowWithCount() {
        let now = Date()
        let events = [
            event("3", agent: "orion", action: "error", reason: "workers_ai_empty_response", at: now),
            event("2", agent: "orion", action: "error", reason: "workers_ai_empty_response", at: now.addingTimeInterval(-60)),
            event("1", agent: "orion", action: "error", reason: "workers_ai_empty_response", at: now.addingTimeInterval(-120)),
            event("0", agent: "pixel", action: "image_enrich", title: "축제", at: now.addingTimeInterval(-180)),
            event("old", agent: "orion", action: "error", reason: "workers_ai_empty_response", at: now.addingTimeInterval(-3 * 3600))
        ]
        let groups = AgentActivityFeed.collapse(events)
        XCTAssertEqual(groups.map(\.count), [3, 1, 1])
        XCTAssertEqual(groups.map(\.event.id), ["3", "0", "old"])
    }

    @MainActor
    func testStatusWithoutActivityMakesNoClaims() {
        let agents = AgentOfficeViewModel.buildAgents(snapshot: .empty, activity: [])
        for id in ["orion", "pixel", "echo", "atlas", "relay", "harbor"] {
            let agent = agents.first { $0.id == id }!
            XCTAssertEqual(agent.status, .idle, id)
        }
        XCTAssertEqual(agents.first { $0.id == "orion" }?.line, "최근 활동 없음")
        XCTAssertEqual(agents.first { $0.id == "atlas" }?.line, "상태 확인 중")
        XCTAssertFalse(agents.contains { $0.line.contains("검증 완료") || $0.reply.contains("검증 완료") })
    }

    @MainActor
    func testStatusFollowsLatestActivity() {
        let now = Date()
        let activity = [
            event("a", agent: "orion", action: "error", reason: "workers_ai_run_failed:4006: daily free allocation", at: now.addingTimeInterval(-30)),
            event("b", agent: "pixel", action: "image_enrich", title: "불꽃축제", at: now.addingTimeInterval(-60)),
            event("c", agent: "echo", action: "post", title: "할인", at: now.addingTimeInterval(-2 * 86400))
        ]
        let agents = AgentOfficeViewModel.buildAgents(snapshot: .empty, activity: activity, now: now)
        let orion = agents.first { $0.id == "orion" }!
        XCTAssertEqual(orion.status, .blocked)
        XCTAssertEqual(orion.line, "AI 일일 한도 도달 · 내일 재개")
        XCTAssertEqual(agents.first { $0.id == "pixel" }?.status, .validating)
        XCTAssertEqual(agents.first { $0.id == "pixel" }?.line, "사진 보강: 불꽃축제")
        // 이틀 전 게시는 기록으로만 보여 주고 "일하는 중"으로 말하지 않는다.
        XCTAssertEqual(agents.first { $0.id == "echo" }?.status, .idle)
        XCTAssertEqual(agents.first { $0.id == "echo" }?.line, "게시: 할인")
    }

    func testBubblesShowAtMostTwoAndDoNotRepeat() {
        let start = Date()
        let activity = ["orion", "pixel", "echo"].enumerated().map { index, agent in
            event("\(index)", agent: agent, action: agent == "orion" ? "error" : (agent == "pixel" ? "image_enrich" : "post"),
                  reason: "workers_ai_empty_response", title: "t", at: start.addingTimeInterval(-10))
        }
        var scheduler = AgentBubbleScheduler()
        var maxVisible = 0
        var shown: [String: Int] = [:]
        var previous: [String: String] = [:]
        for second in 0..<110 {
            let visible = scheduler.tick(activity: activity, now: start.addingTimeInterval(Double(second)))
            maxVisible = max(maxVisible, visible.count)
            for agent in visible.keys where previous[agent] == nil { shown[agent, default: 0] += 1 }
            previous = visible
        }
        XCTAssertLessThanOrEqual(maxVisible, AgentBubbleScheduler.maxVisible)
        XCTAssertEqual(shown.count, 3)
        // 같은 문구는 10분 동안 다시 뜨지 않는다.
        XCTAssertTrue(shown.values.allSatisfy { $0 == 1 })
    }

    func testBubblesIgnoreStaleActivity() {
        let now = Date()
        var scheduler = AgentBubbleScheduler()
        let stale = [event("s", agent: "pixel", action: "image_enrich", title: "t", at: now.addingTimeInterval(-600))]
        XCTAssertTrue(scheduler.tick(activity: stale, now: now).isEmpty)
    }

    @MainActor
    func testVoiceOverLabelExcludesBubbleText() {
        let agent = AgentOfficeViewModel.buildAgents(snapshot: .empty).first { $0.id == "orion" }!
        XCTAssertEqual(AgentOfficeAccessibility.runnerLabel(for: agent), "총괄이, 운영 총괄, 대기")
    }
}
