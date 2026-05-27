import SwiftUI

struct AgentOfficeView: View {
    @StateObject private var viewModel: AgentOfficeViewModel

    init(apiClient: APIClientProtocol) {
        _viewModel = StateObject(wrappedValue: AgentOfficeViewModel(apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                OfficeFloorView(
                    agents: viewModel.agents,
                    snapshot: viewModel.snapshot,
                    activity: viewModel.recentActivity
                )
                    .aspectRatio(0.78, contentMode: .fit)
                AgentRoleStrip(agents: viewModel.agents)
                if !viewModel.recentActivity.isEmpty {
                    ActivityFeed(events: viewModel.recentActivity)
                }
                summaryCard
                providerSection(title: "주차 제공자", providers: viewModel.snapshot.parkingProviders)
                providerSection(title: "탐색 제공자", providers: viewModel.snapshot.discoveryProviders)
                attribution
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("에이전트 사무실")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: refresh) {
                    Image(systemName: viewModel.isLoading ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                .accessibilityLabel("에이전트 사무실 새로고침")
            }
        }
        .task { await viewModel.runPolling() }
        .refreshable { await viewModel.refresh() }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("오리온 요약", systemImage: "brain.head.profile")
                    .font(.headline)
                Spacer()
                Text(viewModel.snapshot.updatedAt, style: .time)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
            Text(viewModel.snapshot.summary)
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.navy)
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.coral)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func providerSection(title: String, providers: [ProviderHealth]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            if providers.isEmpty {
                Text("아직 제공자 상태가 도착하지 않았어요.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
            } else {
                ForEach(providers) { provider in
                    ProviderHealthRow(provider: provider)
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var attribution: some View {
        Text("스프라이트: harishkotra/agent-office · 가구: pixel-agents by Pablo De Lucca (MIT)")
            .font(.caption2)
            .foregroundStyle(FestivalDesign.secondaryText.opacity(0.8))
    }
}

private extension AgentOfficeView {
    func refresh() {
        Task { await viewModel.refresh() }
    }
}

// MARK: - Office floor

private struct OfficeFloorView: View {
    let agents: [AgentOfficeAgent]
    let snapshot: AgentOfficeSnapshot
    let activity: [AgentActivityEvent]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24.0, paused: false)) { timeline in
            GeometryReader { proxy in
                let size = proxy.size
                let t = timeline.date.timeIntervalSinceReferenceDate

                ZStack {
                    PixelOfficeBackdrop()
                    PublishedWall(items: snapshot.published)
                        .frame(width: size.width * 0.52, height: size.height * 0.17)
                        .position(x: size.width * 0.50, y: size.height * 0.18)

                    ForEach(agents) { agent in
                        let live = liveLine(for: agent.id)
                        let frame = OfficeChoreography.frame(
                            for: agent,
                            at: t,
                            snapshot: snapshot,
                            hasLiveActivity: live != nil
                        )
                        let line = live
                            ?? OfficeChoreography.spokenLine(for: agent, frame: frame, snapshot: snapshot)
                        AgentRunner(
                            agent: agent,
                            frame: frame,
                            spokenLine: line
                        )
                        .position(x: frame.position.x * size.width,
                                  y: frame.position.y * size.height)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                        .stroke(FestivalDesign.creamDeep.opacity(0.6), lineWidth: 1)
                )
            }
        }
    }

    private func liveLine(for agentId: String) -> String? {
        guard let event = activity.first(where: { $0.agentId == agentId }) else { return nil }
        guard isRecentActivity(event.ts) else { return nil }
        return formatActivityLine(event)
    }
}

private func isRecentActivity(_ timestamp: String) -> Bool {
    guard let date = AgentOfficeDateParser.formatter.date(from: timestamp) else {
        return false
    }
    return Date().timeIntervalSince(date) < 120
}

private enum AgentOfficeDateParser {
    static let formatter = ISO8601DateFormatter()
    static let wakeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}

private func formatActivityLine(_ event: AgentActivityEvent) -> String? {
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
        return "헤드 LLM 오류"
    case ("pixel", "image_enrich"):
        return title.isEmpty ? "대표 사진 보강" : "사진 보강: \(title)"
    case ("pixel", "image_error"):
        return event.reason ?? "사진 보강 오류"
    case ("pixel", "image_skip"):
        return event.reason ?? "사진 후보 없음"
    case ("echo", "post"):
        return title.isEmpty ? "게시판 등록" : "게시: \(title)"
    default:
        return event.reason
    }
}

private struct AgentRoleStrip: View {
    let agents: [AgentOfficeAgent]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("에이전트 담당")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(agents) { agent in
                        AgentRoleCard(agent: agent)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .padding(14)
        .festivalCard()
    }
}

private struct AgentRoleCard: View {
    let agent: AgentOfficeAgent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(agent.status.color.opacity(0.15))
                    PixelSprite(
                        sheet: agent.spriteAsset,
                        direction: .down,
                        walking: false,
                        walkPhase: 1,
                        scale: 1.05
                    )
                }
                .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(FestivalDesign.navy)
                    Text(agent.role)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(agent.status.color)
                }
            }
            Text(agent.line)
                .font(.caption)
                .foregroundStyle(FestivalDesign.secondaryText)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: 150, alignment: .leading)
        .padding(10)
        .background(FestivalDesign.cream.opacity(0.34))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                .stroke(agent.status.color.opacity(0.22), lineWidth: 1)
        )
    }
}

private struct ActivityFeed: View {
    let events: [AgentActivityEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("최근 활동")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            ForEach(events.prefix(12)) { event in
                ActivityRow(event: event)
            }
        }
        .padding(14)
        .festivalCard()
    }
}

private struct ActivityRow: View {
    let event: AgentActivityEvent

    private var accent: Color {
        switch event.verdict {
        case "approve": return FestivalDesign.teal
        case "reject":  return FestivalDesign.coral
        case "pending": return FestivalDesign.lantern
        default:
            switch event.agentId {
            case "orion": return FestivalDesign.coral
            case "scout": return FestivalDesign.parkingBlue
            case "festa": return FestivalDesign.lantern
            case "pixel": return Color.purple
            case "echo":  return FestivalDesign.teal
            default:      return FestivalDesign.secondaryText
            }
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(accent).frame(width: 8, height: 8).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(event.agentId.uppercased())
                        .font(.caption.bold())
                        .foregroundStyle(accent)
                    Text(event.action)
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                    Spacer()
                    Text(shortTime(event.ts))
                        .font(.caption2)
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(formatActivityLine(event) ?? (event.targetTitle ?? "—"))
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
            }
        }
    }

    private func shortTime(_ ts: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: ts) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return ts
    }
}

// MARK: - Choreography

private struct AgentFrame {
    let position: CGPoint
    let direction: PixelSprite.Direction
    let walking: Bool
    let walkPhase: Int
    let stage: Stage
    let carry: CarryKind?

    enum Stage { case idle, walkingOut, reporting, walkingToWall, posting, returning, patrolling, validating }
    enum CarryKind { case festival, event }
}

private enum OfficeChoreography {
    // Homes target the floor-tile right in front of each agent's desk.
    // Grid is 21 cols × 22 rows; values below are (col+0.5)/21 and (row+0.5)/22.
    private static let homes: [String: CGPoint] = [
        "vera":     CGPoint(x: 0.119, y: 0.341),   // col 2.5, row 7.5
        "orion":    CGPoint(x: 0.500, y: 0.341),   // col 10.5, row 7.5
        "pixel":    CGPoint(x: 0.881, y: 0.341),   // col 18.5, row 7.5
        "festa":    CGPoint(x: 0.119, y: 0.659),   // col 2.5, row 14.5
        "scout":    CGPoint(x: 0.881, y: 0.659),   // col 18.5, row 14.5
        "echo":     CGPoint(x: 0.738, y: 0.886),   // col 15.5, row 19.5
        "sentinel": CGPoint(x: 0.190, y: 0.205)    // col 4,    row 4.5
    ]

    private static let orionDesk = CGPoint(x: 0.500, y: 0.364)
    private static let boardDrop = CGPoint(x: 0.500, y: 0.852)   // in front of PublishedWall cork board

    // Sentinel patrols the room perimeter
    private static let patrolPath: [CGPoint] = [
        CGPoint(x: 0.10, y: 0.20),
        CGPoint(x: 0.50, y: 0.16),
        CGPoint(x: 0.90, y: 0.20),
        CGPoint(x: 0.90, y: 0.50),
        CGPoint(x: 0.50, y: 0.55),
        CGPoint(x: 0.10, y: 0.50)
    ]

    static func frame(for agent: AgentOfficeAgent, at t: TimeInterval, snapshot: AgentOfficeSnapshot, hasLiveActivity: Bool) -> AgentFrame {
        let home = homes[agent.id] ?? CGPoint(x: 0.5, y: 0.5)
        guard agent.status.movesInOffice || hasLiveActivity else {
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }

        switch agent.id {
        case "festa":
            return collectorFrame(id: agent.id, t: t, offset: 0,
                                  carry: .festival,
                                  itemCount: snapshot.festivals.count)
        case "scout":
            return collectorFrame(id: agent.id, t: t, offset: 12,
                                  carry: .event,
                                  itemCount: snapshot.events.count)
        case "orion":
            let dir: PixelSprite.Direction = (Int(t) % 8 < 4) ? .down : .left
            return AgentFrame(position: home, direction: dir, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case "vera":
            return validatorFrame(t: t)
        case "pixel":
            return imageFrame(t: t, hasMissingImages: snapshot.missingImageCount > 0 || hasLiveActivity)
        case "echo":
            return publisherFrame(t: t, hasItems: snapshot.published.count > 0)
        case "sentinel":
            return patrolFrame(t: t)
        default:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
    }

    // 24-second cycle: home(5s) → walk to Orion(4s) → report(4s) → walk to board drop-off(4s) → post(2s) → walk home(5s)
    private static func collectorFrame(id: String, t: TimeInterval, offset: Double,
                                       carry: AgentFrame.CarryKind, itemCount: Int) -> AgentFrame {
        let cycle: Double = 24
        let tau = (t + offset).truncatingRemainder(dividingBy: cycle)
        let home = homes[id]!
        let walking3 = Int(t * 6) % 3

        if itemCount == 0 {
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }

        switch tau {
        case 0..<5:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case 5..<9:
            let p = ease((tau - 5) / 4)
            let pos = routedLerp(home, orionDesk, p, corridorY: 0.62)
            let prev = routedLerp(home, orionDesk, max(0, p - 0.03), corridorY: 0.62)
            let dir = direction(from: prev, to: pos)
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .walkingOut, carry: carry)
        case 9..<13:
            let dir: PixelSprite.Direction = orionDesk.x > home.x ? .right : .left
            return AgentFrame(position: orionDesk, direction: dir, walking: false, walkPhase: 1,
                              stage: .reporting, carry: carry)
        case 13..<17:
            let p = ease((tau - 13) / 4)
            let pos = routedLerp(orionDesk, boardDrop, p, corridorY: 0.68)
            let prev = routedLerp(orionDesk, boardDrop, max(0, p - 0.03), corridorY: 0.68)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: carry)
        case 17..<19:
            return AgentFrame(position: boardDrop, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: carry)
        default:
            let p = ease((tau - 19) / 5)
            let pos = routedLerp(boardDrop, home, p, corridorY: 0.68)
            let prev = routedLerp(boardDrop, home, max(0, p - 0.03), corridorY: 0.68)
            let dir = direction(from: prev, to: pos)
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .returning, carry: nil)
        }
    }

    private static func validatorFrame(t: TimeInterval) -> AgentFrame {
        // Vera oscillates between her desk and Orion's desk to validate.
        let home = homes["vera"]!
        let target = CGPoint(x: 0.30, y: 0.341)
        let cycle: Double = 8
        let tau = t.truncatingRemainder(dividingBy: cycle) / cycle
        let p = (sin(tau * .pi * 2) + 1) / 2
        let pos = routedLerp(home, target, p, corridorY: 0.341)
        let walking3 = Int(t * 4) % 3
        let walking = p > 0.05 && p < 0.95
        let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.62)
        let dir = direction(from: prev, to: pos)
        return AgentFrame(position: pos, direction: dir, walking: walking, walkPhase: walking3,
                          stage: .validating, carry: nil)
    }

    private static func imageFrame(t: TimeInterval, hasMissingImages: Bool) -> AgentFrame {
        let home = homes["pixel"]!
        guard hasMissingImages else {
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        let target = CGPoint(x: 0.56, y: 0.76)
        let cycle: Double = 18
        let tau = t.truncatingRemainder(dividingBy: cycle)
        let walking3 = Int(t * 6) % 3
        switch tau {
        case 0..<7:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .validating, carry: nil)
        case 7..<10:
            let p = ease((tau - 7) / 3)
            let pos = routedLerp(home, target, p, corridorY: 0.68)
            let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.68)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                              walking: true, walkPhase: walking3, stage: .walkingToWall, carry: nil)
        case 10..<13:
            return AgentFrame(position: target, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 13) / 5)
            let pos = routedLerp(target, home, p, corridorY: 0.68)
            let prev = routedLerp(target, home, max(0, p - 0.03), corridorY: 0.68)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                              walking: true, walkPhase: walking3, stage: .returning, carry: nil)
        }
    }

    private static func publisherFrame(t: TimeInterval, hasItems: Bool) -> AgentFrame {
        let home = homes["echo"]!
        let cycle: Double = 16
        let tau = t.truncatingRemainder(dividingBy: cycle)
        let walking3 = Int(t * 6) % 3
        guard hasItems else {
            return AgentFrame(position: home, direction: .left, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        switch tau {
        case 0..<10:
            return AgentFrame(position: home, direction: .left, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case 10..<12:
            let p = ease((tau - 10) / 2)
            let target = CGPoint(x: 0.58, y: 0.76)
            let pos = routedLerp(home, target, p, corridorY: 0.84)
            let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.84)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: nil)
        case 12..<14:
            return AgentFrame(position: CGPoint(x: 0.58, y: 0.76), direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 14) / 2)
            let target = CGPoint(x: 0.58, y: 0.76)
            let pos = routedLerp(target, home, p, corridorY: 0.84)
            let prev = routedLerp(target, home, max(0, p - 0.03), corridorY: 0.84)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .returning, carry: nil)
        }
    }

    private static func patrolFrame(t: TimeInterval) -> AgentFrame {
        let segDuration: Double = 6
        let total = Double(patrolPath.count) * segDuration
        let tau = t.truncatingRemainder(dividingBy: total)
        let segIndex = Int(tau / segDuration)
        let local = (tau - Double(segIndex) * segDuration) / segDuration
        let from = patrolPath[segIndex]
        let to = patrolPath[(segIndex + 1) % patrolPath.count]
        let pos = lerp(from, to, ease(local))
        let walking3 = Int(t * 6) % 3
        let dx = to.x - from.x
        let dy = to.y - from.y
        let dir: PixelSprite.Direction
        if abs(dx) > abs(dy) {
            dir = dx >= 0 ? .right : .left
        } else {
            dir = dy >= 0 ? .down : .up
        }
        return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                          stage: .patrolling, carry: nil)
    }

    static func spokenLine(for agent: AgentOfficeAgent, frame: AgentFrame,
                           snapshot: AgentOfficeSnapshot) -> String? {
        if agent.status == .idle {
            return nextWakeLine(for: agent.id, at: Date())
        }
        guard agent.status.canSpeakInOffice else { return nil }
        switch agent.id {
        case "festa":
            return collectorLine(stage: frame.stage, items: snapshot.festivals, fallback: agent.line)
        case "scout":
            return collectorLine(stage: frame.stage, items: snapshot.events, fallback: agent.line)
        case "orion":
            // Show approval when a collector is reporting nearby
            let reporterActive = snapshot.festivals.count > 0 || snapshot.events.count > 0
            if reporterActive, Int(Date().timeIntervalSince1970) % 8 < 3 {
                return "확인했어요. 게시판에 올려요."
            }
            return nil
        case "vera":
            switch frame.stage {
            case .validating: return agent.line
            default: return nil
            }
        case "pixel":
            switch frame.stage {
            case .validating: return agent.line
            case .posting: return "대표 사진을 붙였어요."
            default: return nil
            }
        case "echo":
            switch frame.stage {
            case .posting: return "푸시 일정 잡아둘게요."
            default: return nil
            }
        case "sentinel":
            // Speak only at corners
            let segDuration: Double = 6
            let total = Double(6) * segDuration
            let tau = Date().timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: total)
            let local = tau - Double(Int(tau / segDuration)) * segDuration
            return local < 1.0 ? agent.line : nil
        default:
            return nil
        }
    }

    private static func collectorLine(stage: AgentFrame.Stage, items: [DiscoveryItem], fallback: String) -> String? {
        guard !items.isEmpty else { return nil }
        let pickIndex = Int(Date().timeIntervalSince1970 / 24) % items.count
        let title = items[pickIndex].title
        switch stage {
        case .walkingOut, .walkingToWall:
            return "「\(title)」"
        case .reporting:
            return "총괄님, \(title) 찾았어요!"
        case .posting:
            return "게시판에 붙입니다."
        default:
            return nil
        }
    }

    private static func nextWakeLine(for agentId: String, at date: Date) -> String? {
        guard let wakeDate = nextWakeDate(for: agentId, after: date) else { return nil }
        return "다음 \(formatWakeTime(wakeDate))에 깨어나요."
    }

    private static func nextWakeDate(for agentId: String, after date: Date) -> Date? {
        switch agentId {
        case "festa":
            return nextMinuteSlot(after: date, intervalMinutes: 9)
        case "scout":
            return nextHourlyMinute(after: date, minute: 15)
        case "orion", "pixel", "echo":
            return nextThreeHourSlot(after: date, minute: 30)
        case "vera", "sentinel":
            return Calendar.current.date(byAdding: .second, value: 20, to: date)
        default:
            return nil
        }
    }

    private static func nextMinuteSlot(after date: Date, intervalMinutes: Int) -> Date? {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard let minute = components.minute else { return nil }
        let nextMinute = ((minute / intervalMinutes) + 1) * intervalMinutes
        if nextMinute < 60 {
            var nextComponents = components
            nextComponents.minute = nextMinute
            nextComponents.second = 0
            return calendar.date(from: nextComponents)
        }
        guard let nextHour = calendar.date(byAdding: .hour, value: 1, to: date) else { return nil }
        var nextComponents = calendar.dateComponents([.year, .month, .day, .hour], from: nextHour)
        nextComponents.minute = 0
        nextComponents.second = 0
        return calendar.date(from: nextComponents)
    }

    private static func nextHourlyMinute(after date: Date, minute: Int) -> Date? {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        components.minute = minute
        components.second = 0
        guard let candidate = calendar.date(from: components) else { return nil }
        if candidate > date { return candidate }
        return calendar.date(byAdding: .hour, value: 1, to: candidate)
    }

    private static func nextThreeHourSlot(after date: Date, minute: Int) -> Date? {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        guard let hour = components.hour else { return nil }
        for offset in 0...4 {
            let candidateHour = ((hour / 3) * 3) + (offset * 3)
            var nextComponents = components
            nextComponents.hour = candidateHour % 24
            nextComponents.minute = minute
            nextComponents.second = 0
            guard var candidate = calendar.date(from: nextComponents) else { continue }
            if candidateHour >= 24 {
                candidate = calendar.date(byAdding: .day, value: candidateHour / 24, to: candidate) ?? candidate
            }
            if candidate > date { return candidate }
        }
        return nil
    }

    private static func formatWakeTime(_ date: Date) -> String {
        AgentOfficeDateParser.wakeFormatter.string(from: date)
    }

    private static func ease(_ x: Double) -> Double {
        let c = max(0, min(1, x))
        return c < 0.5 ? 2 * c * c : 1 - pow(-2 * c + 2, 2) / 2
    }

    private static func routedLerp(_ start: CGPoint, _ end: CGPoint, _ progress: Double, corridorY: CGFloat) -> CGPoint {
        let corridorStart = CGPoint(x: start.x, y: corridorY)
        let corridorEnd = CGPoint(x: end.x, y: corridorY)
        let rawPoints = [start, corridorStart, corridorEnd, end]
        let points = rawPoints.reduce(into: [CGPoint]()) { result, point in
            guard result.last.map({ distance($0, point) > 0.001 }) ?? true else { return }
            result.append(point)
        }
        return point(on: points, progress: progress)
    }

    private static func point(on points: [CGPoint], progress: Double) -> CGPoint {
        guard points.count > 1 else { return points.first ?? .zero }
        let lengths = zip(points, points.dropFirst()).map { distance($0, $1) }
        let total = lengths.reduce(0, +)
        guard total > 0 else { return points.last ?? .zero }

        var remaining = CGFloat(max(0, min(1, progress))) * total
        for index in lengths.indices {
            let length = lengths[index]
            if remaining <= length {
                let local = Double(remaining / length)
                return lerp(points[index], points[index + 1], local)
            }
            remaining -= length
        }
        return points.last ?? .zero
    }

    private static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(b.x - a.x, b.y - a.y)
    }

    private static func direction(from a: CGPoint, to b: CGPoint) -> PixelSprite.Direction {
        let dx = b.x - a.x
        let dy = b.y - a.y
        if abs(dx) > abs(dy) {
            return dx >= 0 ? .right : .left
        }
        return dy >= 0 ? .down : .up
    }

    private static func lerp(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * CGFloat(t),
                y: a.y + (b.y - a.y) * CGFloat(t))
    }
}

private extension AgentOfficeStatus {
    var movesInOffice: Bool {
        switch self {
        case .thinking, .collecting, .validating, .monitoring:
            return true
        case .idle, .blocked, .error:
            return false
        }
    }

    var canSpeakInOffice: Bool {
        switch self {
        case .idle:
            return false
        case .thinking, .collecting, .validating, .monitoring, .blocked, .error:
            return true
        }
    }
}

// MARK: - Agent runner (sprite + name + carry + bubble)

private struct AgentRunner: View {
    let agent: AgentOfficeAgent
    let frame: AgentFrame
    let spokenLine: String?

    var body: some View {
        ZStack {
            // Shadow
            Ellipse()
                .fill(FestivalDesign.navy.opacity(0.18))
                .frame(width: 24, height: 6)
                .offset(y: 24)

            PixelSprite(
                sheet: agent.spriteAsset,
                direction: frame.direction,
                walking: frame.walking,
                walkPhase: frame.walkPhase,
                scale: 1.6
            )

            if let carry = frame.carry {
                CarryMarker(kind: carry)
                    .offset(x: 10, y: -16)
            }

            if let line = spokenLine {
                PixelBubble(text: line, speaker: agent.name, accent: agent.status.color)
                    .offset(y: -44)
            }

            Text(agent.name)
                .font(.system(size: 8, weight: .semibold))
                .padding(.horizontal, 3)
                .padding(.vertical, 1)
                .background(FestivalDesign.surface.opacity(0.9))
                .clipShape(Capsule())
                .offset(y: 32)
                .foregroundStyle(FestivalDesign.navy)
        }
        .frame(width: 90, height: 90)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role)\(spokenLine.map { ", \($0)" } ?? "")")
    }
}

private struct CarryMarker: View {
    let kind: AgentFrame.CarryKind

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 12, height: 12)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(FestivalDesign.navy.opacity(0.6), lineWidth: 1)
                )
            Text(symbol)
                .font(.system(size: 8))
        }
    }

    private var color: Color {
        switch kind {
        case .festival: return FestivalDesign.lantern.opacity(0.9)
        case .event: return FestivalDesign.parkingBlue.opacity(0.85)
        }
    }

    private var symbol: String {
        switch kind {
        case .festival: return "🎪"
        case .event: return "🎟"
        }
    }
}

private struct PixelBubble: View {
    let text: String
    let speaker: String
    let accent: Color

    var body: some View {
        VStack(spacing: 1) {
            Text(speaker)
                .font(.system(size: 7, weight: .heavy))
                .tracking(0.4)
                .foregroundStyle(accent)
            Text(text)
                .font(.system(size: 9))
                .foregroundStyle(FestivalDesign.navy)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .frame(maxWidth: 130)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(FestivalDesign.surface)
                Triangle()
                    .fill(FestivalDesign.surface)
                    .frame(width: 6, height: 4)
                    .offset(y: 18)
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(accent.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.10), radius: 3, y: 1)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Pixel backdrop (PNG sprite scene)

// MARK: - PixelOfficeBackdrop (pixel-agents tileset)
//
// Tile grid: 21 cols × 22 rows. Wall band rows 0–2, floor rows 3–21.
// Furniture sprites are anchored top-left at (col, row) tiles.
// Character choreography uses normalized (0..1) coords on the SAME geometry.

private enum OfficeLayout {
    static let cols = 21
    static let rows = 22
    static let wallBandRows = 3  // top rows that show the wall

    struct Furn {
        let id: String       // imageset suffix (without PA- prefix)
        let col: Int
        let row: Int         // top-left grid row (sprite extends down by h tiles)
        let w: Int           // sprite width in tiles
        let h: Int           // sprite height in tiles
        let flipH: Bool      // mirror horizontally
        init(_ id: String, col: Int, row: Int, w: Int, h: Int, flipH: Bool = false) {
            self.id = id; self.col = col; self.row = row
            self.w = w; self.h = h; self.flipH = flipH
        }
    }

    // Wall-mounted decor (anchored within rows 0–2)
    static let wallDecor: [Furn] = [
        Furn("BOOKSHELF",       col: 1,  row: 1, w: 2, h: 1),
        Furn("LARGE_PAINTING",  col: 4,  row: 0, w: 2, h: 2),
        Furn("CLOCK",           col: 7,  row: 0, w: 1, h: 2),
        Furn("WHITEBOARD",      col: 9,  row: 0, w: 2, h: 2),
        Furn("SMALL_PAINTING",  col: 12, row: 0, w: 1, h: 2),
        Furn("LARGE_PAINTING",  col: 14, row: 0, w: 2, h: 2),
        Furn("SMALL_PAINTING_2",col: 17, row: 0, w: 1, h: 2),
        Furn("BOOKSHELF",       col: 18, row: 1, w: 2, h: 1),
    ]

    // Hanging plants (decor pinned near wall band, top edge of floor)
    static let hangings: [Furn] = [
        Furn("HANGING_PLANT", col: 0,  row: 3, w: 1, h: 2),
        Furn("HANGING_PLANT", col: 20, row: 3, w: 1, h: 2),
    ]

    // Top desk row: vera (left), orion (center boss), pixel (right)
    static let topDesks: [Furn] = [
        // vera ~ col 1–3, anchor desk at row 5–6
        Furn("DESK_FRONT",         col: 1,  row: 5, w: 3, h: 2),
        Furn("PC_FRONT_OFF",       col: 2,  row: 4, w: 1, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 2,  row: 7, w: 1, h: 2),
        // orion ~ col 9–11, boss center
        Furn("DESK_FRONT",         col: 9,  row: 5, w: 3, h: 2),
        Furn("PC_FRONT_OFF",       col: 10, row: 4, w: 1, h: 2),
        Furn("CUSHIONED_CHAIR_BACK", col: 10, row: 7, w: 1, h: 1),
        // pixel ~ col 17–19
        Furn("DESK_FRONT",         col: 17, row: 5, w: 3, h: 2),
        Furn("PC_FRONT_OFF",       col: 18, row: 4, w: 1, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 18, row: 7, w: 1, h: 2),
    ]

    // Mid-room: festa (left) and scout (right) desks + a mid bookshelf cluster
    static let midDesks: [Furn] = [
        Furn("DESK_FRONT",         col: 1,  row: 12, w: 3, h: 2),
        Furn("PC_FRONT_OFF",       col: 2,  row: 11, w: 1, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 2,  row: 14, w: 1, h: 2),
        Furn("DOUBLE_BOOKSHELF",   col: 9,  row: 11, w: 2, h: 2),
        Furn("PLANT_2",            col: 11, row: 11, w: 1, h: 2),
        Furn("DESK_FRONT",         col: 17, row: 12, w: 3, h: 2),
        Furn("PC_FRONT_OFF",       col: 18, row: 11, w: 1, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 18, row: 14, w: 1, h: 2),
    ]

    // Meeting nook in the center bottom: sofa + coffee table
    static let meetingNook: [Furn] = [
        Furn("SOFA_BACK",   col: 8,  row: 15, w: 2, h: 1),
        Furn("SOFA_SIDE",   col: 7,  row: 16, w: 1, h: 2),
        Furn("SOFA_SIDE",   col: 10, row: 16, w: 1, h: 2, flipH: true),
        Furn("COFFEE_TABLE",col: 8,  row: 17, w: 2, h: 2),
        Furn("COFFEE",      col: 8,  row: 17, w: 1, h: 1),
    ]

    // Echo + amenities (bottom-right cluster, leaves bottom-center clear for PublishedWall)
    static let amenities: [Furn] = [
        // echo desk
        Furn("DESK_FRONT",         col: 14, row: 16, w: 3, h: 2),
        Furn("PC_FRONT_OFF",       col: 15, row: 15, w: 1, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 15, row: 18, w: 1, h: 2),
        // plants
        Furn("LARGE_PLANT", col: 0,  row: 16, w: 2, h: 3),
        Furn("LARGE_PLANT", col: 19, row: 18, w: 2, h: 3),
        Furn("PLANT",       col: 5,  row: 12, w: 1, h: 2),
        Furn("CACTUS",      col: 18, row: 12, w: 1, h: 2, flipH: true),
        // misc
        Furn("BIN", col: 1,  row: 20, w: 1, h: 1),
        Furn("POT", col: 4,  row: 20, w: 1, h: 1),
    ]

    static var allFurniture: [Furn] {
        wallDecor + hangings + topDesks + midDesks + meetingNook + amenities
    }
}

private struct PixelOfficeBackdrop: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            let tile = min(w / CGFloat(OfficeLayout.cols),
                           h / CGFloat(OfficeLayout.rows))
            let roomW = tile * CGFloat(OfficeLayout.cols)
            let roomH = tile * CGFloat(OfficeLayout.rows)
            let offX = (w - roomW) / 2
            let offY = (h - roomH) / 2

            ZStack(alignment: .topLeading) {
                FloorTileGrid(tile: tile)
                    .frame(width: roomW, height: roomH)

                ForEach(Array(OfficeLayout.allFurniture.enumerated()), id: \.offset) { _, furn in
                    PixelTile(name: "PA-\(furn.id)",
                              widthTiles: furn.w, heightTiles: furn.h,
                              tile: tile, flipH: furn.flipH)
                        .offset(x: CGFloat(furn.col) * tile,
                                y: CGFloat(furn.row) * tile)
                }

                FloorShadowBaseboard(tile: tile)
                    .frame(width: roomW, height: tile)
                    .offset(y: CGFloat(OfficeLayout.wallBandRows) * tile - tile * 0.5)
            }
            .frame(width: roomW, height: roomH)
            .offset(x: offX, y: offY)

            HStack(spacing: 4) {
                Rectangle()
                    .fill(FestivalDesign.teal)
                    .frame(width: 6, height: 6)
                Text("업무 진행 중")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(FestivalDesign.surface)
            .overlay(Rectangle().stroke(FestivalDesign.navy.opacity(0.7), lineWidth: 1))
            .position(x: w - 62, y: 22)
        }
    }
}

private struct PixelTile: View {
    let name: String
    let widthTiles: Int
    let heightTiles: Int
    let tile: CGFloat
    let flipH: Bool
    var body: some View {
        Image(name)
            .resizable()
            .interpolation(.none)
            .frame(width: tile * CGFloat(widthTiles),
                   height: tile * CGFloat(heightTiles))
            .scaleEffect(x: flipH ? -1 : 1, y: 1, anchor: .center)
    }
}

// Floor: wall band on rows 0..wallBandRows-1 (cream wallpaper),
// wood-plank floor below using PA-floor_1 tiled per cell.
private struct FloorTileGrid: View {
    let tile: CGFloat
    var body: some View {
        ZStack(alignment: .topLeading) {
            // Wall (cream with subtle dot pattern)
            Rectangle()
                .fill(Color(red: 0.96, green: 0.91, blue: 0.78))
                .frame(width: tile * CGFloat(OfficeLayout.cols),
                       height: tile * CGFloat(OfficeLayout.wallBandRows))
            // Floor tiles
            ForEach(OfficeLayout.wallBandRows..<OfficeLayout.rows, id: \.self) { r in
                ForEach(0..<OfficeLayout.cols, id: \.self) { c in
                    Image("PA-floor_1")
                        .resizable()
                        .interpolation(.none)
                        .frame(width: tile, height: tile)
                        .offset(x: CGFloat(c) * tile, y: CGFloat(r) * tile)
                }
            }
        }
    }
}

// Dark band at the wall/floor seam (baseboard shadow)
private struct FloorShadowBaseboard: View {
    let tile: CGFloat
    var body: some View {
        Rectangle()
            .fill(Color(red: 0.18, green: 0.13, blue: 0.10).opacity(0.35))
            .frame(height: max(2, tile * 0.18))
    }
}

// MARK: - Published wall

private struct PublishedWall: View {
    let items: [DiscoveryItem]

    var body: some View {
        ZStack {
            // Opaque pixel cork board. It intentionally sits on an empty
            // center wall strip so furniture and agents never hide behind it.
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(red: 0.78, green: 0.55, blue: 0.30))
                .overlay(PixelBoardDots().opacity(0.42))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(red: 0.28, green: 0.17, blue: 0.10), lineWidth: 3)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(red: 0.96, green: 0.75, blue: 0.38), lineWidth: 1)
                        .padding(4)
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("게시판")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(FestivalDesign.navy)
                    Spacer()
                    Text("\(items.count)건")
                        .font(.system(size: 8))
                        .foregroundStyle(FestivalDesign.navy.opacity(0.75))
                }
                if items.isEmpty {
                    Text("아직 게시된 항목이 없어요.")
                        .font(.system(size: 9))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    HStack(spacing: 4) {
                        ForEach(items.prefix(6)) { item in
                            PublishedCard(item: item)
                        }
                    }
                }
            }
            .padding(6)
        }
    }
}

private struct PixelBoardDots: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 8
            let dot = Color(red: 0.40, green: 0.23, blue: 0.12)
            var y: CGFloat = 4
            while y < size.height {
                var x: CGFloat = 4
                while x < size.width {
                    let rect = CGRect(x: x, y: y, width: 2, height: 2)
                    context.fill(Path(rect), with: .color(dot))
                    x += step
                }
                y += step
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct PublishedCard: View {
    let item: DiscoveryItem

    var body: some View {
        VStack(spacing: 2) {
            Text(symbol)
                .font(.system(size: 11))
            Text(item.title)
                .font(.system(size: 7, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(3)
        .frame(maxWidth: .infinity, minHeight: 36)
        .background(FestivalDesign.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(accent.opacity(0.6), lineWidth: 1)
        )
        .overlay(
            Circle()
                .fill(FestivalDesign.coral)
                .frame(width: 4, height: 4)
                .offset(y: -16),
            alignment: .top
        )
    }

    private var symbol: String {
        switch item.kind {
        case .festival: return "🎪"
        case .event: return "🎟"
        }
    }

    private var accent: Color {
        switch item.kind {
        case .festival: return FestivalDesign.lantern
        case .event: return FestivalDesign.parkingBlue
        }
    }
}

// MARK: - Provider row

private struct ProviderHealthRow: View {
    let provider: ProviderHealth

    private var color: Color {
        if provider.stale { return FestivalDesign.coral }
        switch provider.status.lowercased() {
        case "up": return FestivalDesign.teal
        case "degraded": return FestivalDesign.lantern
        case "down", "stale": return FestivalDesign.coral
        default: return FestivalDesign.secondaryText
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                    .font(.subheadline.bold())
                    .foregroundStyle(FestivalDesign.navy)
                Text(provider.lastError ?? "품질 \(Int(provider.qualityScore * 100))%")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
            Text(providerStatusText)
                .font(.caption.bold())
                .foregroundStyle(color)
        }
        .padding(.vertical, 6)
    }

    private var providerStatusText: String {
        if provider.stale { return "지연" }
        switch provider.status.lowercased() {
        case "up": return "정상"
        case "degraded": return "주의"
        case "down": return "중단"
        case "stale": return "지연"
        default: return provider.status
        }
    }
}

#Preview {
    NavigationStack {
        AgentOfficeView(apiClient: MockAPIClient())
    }
}
