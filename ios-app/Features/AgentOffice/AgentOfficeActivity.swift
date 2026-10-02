import Foundation

/// Worker `agent_activity.ts`는 `toISOString()`이라 소수점 초(`.477Z`)가 붙는다.
/// 기본 `ISO8601DateFormatter`는 그 형식을 못 읽어 모든 활동이 "오래된 것"으로 취급됐다.
enum AgentOfficeDates {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ timestamp: String) -> Date? {
        fractional.date(from: timestamp) ?? plain.date(from: timestamp)
    }
}

/// 활동 한 줄을 사용자에게 보여 줄 짧은 문장으로 바꾼다. 오류 원문·프롬프트는 내보내지 않는다.
enum AgentActivityText {
    static let errorActions: Set<String> = ["error", "apply_error", "query_error", "image_error"]

    static func isError(_ event: AgentActivityEvent) -> Bool {
        errorActions.contains(event.action)
    }

    /// 총괄이 오류 사유를 종류별 문구로 나눈다. 원문은 버린다.
    static func headErrorLabel(reason: String?) -> String {
        let reason = reason ?? ""
        if reason.contains("4006") || reason.localizedCaseInsensitiveContains("daily free allocation") {
            return "AI 일일 한도 도달 · 내일 재개"
        }
        if reason.hasPrefix("workers_ai_empty_response") { return "AI 응답이 비어 있음" }
        if reason.hasPrefix("workers_ai_json_parse_failed") { return "AI 응답 형식 오류" }
        if reason.hasPrefix("workers_ai_run_failed") { return "AI 호출 실패" }
        return "검토 중 오류"
    }

    static func line(for event: AgentActivityEvent) -> String? {
        let title = event.targetTitle ?? ""
        switch (event.agentId, event.action) {
        case ("scout", "found"):
            return title.isEmpty ? "후보 발견" : "발견: \(title)"
        case ("festa", "found"):
            return title.isEmpty ? "축제 후보 발견" : "발견: \(title)"
        case ("orion", "validate"):
            let prefix: String
            switch event.verdict {
            case "approve": prefix = "승인"
            case "reject":  prefix = "거절"
            default:        prefix = "보류"
            }
            if let reason = event.reason, !reason.isEmpty {
                return "\(prefix): \(reason)"
            }
            return title.isEmpty ? prefix : "\(prefix): \(title)"
        case ("orion", "reconsider"):
            let prefix = event.verdict == "approve" ? "복구 승인" : "재검토"
            if let reason = event.reason, !reason.isEmpty {
                return "\(prefix): \(reason)"
            }
            return title.isEmpty ? prefix : "\(prefix): \(title)"
        case ("orion", "error"):
            return headErrorLabel(reason: event.reason)
        case ("orion", "apply_error"):
            return "검토 결과 반영 실패"
        case ("orion", "query_error"):
            return "검토 대상 조회 실패"
        case ("pixel", "image_enrich"):
            return title.isEmpty ? "대표 사진 보강" : "사진 보강: \(title)"
        case ("pixel", "image_error"):
            return "사진 보강 실패"
        case ("pixel", "image_skip"):
            return title.isEmpty ? "사진 후보 없음" : "사진 후보 없음: \(title)"
        case ("echo", "post"):
            return title.isEmpty ? "게시판 등록" : "게시: \(title)"
        default:
            // 모르는 오류 종류의 사유는 원문일 수 있어 내보내지 않는다.
            return isError(event) ? "작업 중 오류" : event.reason
        }
    }

    /// 같은 오류가 반복돼도 하나로 묶일 수 있게, 오류는 원문 대신 표시 문구로 비교한다.
    static func groupKey(for event: AgentActivityEvent) -> String {
        let detail = isError(event) ? (line(for: event) ?? "") : (event.reason ?? "")
        return "\(event.agentId)|\(event.action)|\(detail)"
    }
}

struct AgentActivityGroup: Identifiable {
    let event: AgentActivityEvent
    let count: Int
    var id: String { event.id }
}

enum AgentActivityFeed {
    /// 최신순 목록에서 같은 agent+action+사유가 `window` 안에 이어지면 최신 한 줄 + 횟수로 접는다.
    /// DB 기록은 그대로고 화면만 접는다 — 반복 오류가 정상 활동을 밀어내지 않게 하려는 것.
    static func collapse(_ events: [AgentActivityEvent], window: TimeInterval = 10 * 60) -> [AgentActivityGroup] {
        var groups: [(event: AgentActivityEvent, count: Int, oldest: Date?)] = []
        var openIndex: [String: Int] = [:]
        for event in events {
            let key = AgentActivityText.groupKey(for: event)
            let date = AgentOfficeDates.parse(event.ts)
            if let index = openIndex[key],
               let oldest = groups[index].oldest, let date,
               oldest.timeIntervalSince(date) <= window {
                groups[index].count += 1
                groups[index].oldest = date
                continue
            }
            openIndex[key] = groups.count
            groups.append((event, 1, date))
        }
        return groups.map { AgentActivityGroup(event: $0.event, count: $0.count) }
    }
}

/// 말풍선은 실제 최근 활동에서만 나온다. 상태 추정 문구로 말하지 않는다.
struct AgentBubbleScheduler {
    static let maxVisible = 2
    static let freshness: TimeInterval = 120
    static let visibleDuration: TimeInterval = 6
    static let gapBetweenBubbles: TimeInterval = 3
    static let perAgentCooldown: TimeInterval = 45
    static let sameTextCooldown: TimeInterval = 10 * 60

    private var visible: [String: (text: String, until: Date)] = [:]
    private var lastShown: [String: (text: String, at: Date)] = [:]
    private var lastStart: Date?

    /// 지금 떠 있어야 할 말풍선 (agentId → 문구). 한 번에 최대 하나씩 새로 띄운다.
    mutating func tick(activity: [AgentActivityEvent], now: Date) -> [String: String] {
        visible = visible.filter { $0.value.until > now }

        let gapPassed = lastStart.map { now.timeIntervalSince($0) >= Self.gapBetweenBubbles } ?? true
        if visible.count < Self.maxVisible, gapPassed,
           let next = nextCandidate(activity: activity, now: now) {
            visible[next.agentId] = (next.text, now.addingTimeInterval(Self.visibleDuration))
            lastShown[next.agentId] = (next.text, now)
            lastStart = now
        }
        return visible.mapValues(\.text)
    }

    private func nextCandidate(activity: [AgentActivityEvent], now: Date) -> (agentId: String, text: String)? {
        var seenAgents = Set<String>()
        for event in activity {
            // 에이전트마다 가장 최신 활동 하나만 본다.
            guard seenAgents.insert(event.agentId).inserted else { continue }
            guard visible[event.agentId] == nil,
                  let date = AgentOfficeDates.parse(event.ts),
                  now.timeIntervalSince(date) < Self.freshness,
                  let text = AgentActivityText.line(for: event), !text.isEmpty else { continue }
            if let last = lastShown[event.agentId] {
                let elapsed = now.timeIntervalSince(last.at)
                if elapsed < Self.perAgentCooldown { continue }
                if last.text == text, elapsed < Self.sameTextCooldown { continue }
            }
            return (event.agentId, text)
        }
        return nil
    }
}

enum AgentOfficeAccessibility {
    /// 이름·역할·상태만 읽는다. 말풍선 문구는 화면 장식이라 VoiceOver가 다시 읽지 않는다.
    static func runnerLabel(for agent: AgentOfficeAgent) -> String {
        "\(agent.name), \(agent.role), \(agent.status.title)"
    }
}
